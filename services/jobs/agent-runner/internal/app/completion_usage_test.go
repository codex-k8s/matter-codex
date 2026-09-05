package app

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/codex-k8s/kodex/libs/go/runtimecontract"
	"github.com/codex-k8s/kodex/services/jobs/agent-runner/internal/callback"
	"github.com/codex-k8s/kodex/services/jobs/agent-runner/internal/codex"
	"github.com/codex-k8s/kodex/services/jobs/agent-runner/internal/model"
)

func TestExecutedTurnFailurePreservesUsageInRetriedCallback(t *testing.T) {
	usage := runtimecontract.TokenUsage{TotalTokens: 150, InputTokens: 100, CachedInputTokens: 30, CacheWriteInputTokens: 10, OutputTokens: 50, ReasoningOutputTokens: 20, ModelContextWindow: 32768}
	for _, mode := range []string{"workspace", "cancelled workspace", "empty message", "oversized message", "invalid utf8", "publish result", "collect artifacts", "completion archive", "provider failure", "success", "before execution"} {
		t.Run(mode, func(t *testing.T) {
			input := model.Input{RuntimeRevisionRef: "rrev_fixture", RuntimeRevisionVersion: 1, RuntimeRevisionDigest: strings.Repeat("a", 64), Attempt: 3, LeaseRef: "lease_fixture", ExecutionBindingDigest: strings.Repeat("b", 64), WorkspaceRoot: t.TempDir(), WorkspacePolicy: runtimecontract.RuntimeWorkspacePolicyV1()}
			result := codex.Result{Outcome: "SUCCEEDED", FinalMessage: "synthetic result", Usage: usage}
			check := func(context.Context) error { return nil }
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			wantCode := "PROVIDER_RESPONSE_INVALID"
			switch mode {
			case "workspace", "cancelled workspace":
				check = func(context.Context) error { return errors.New("synthetic quota denial") }
				wantCode = "RUNTIME_INPUT_INVALID"
				if mode == "cancelled workspace" {
					cancel()
				}
			case "empty message":
				result.FinalMessage = " "
			case "oversized message":
				result.FinalMessage = strings.Repeat("x", 64<<10+1)
			case "invalid utf8":
				result.FinalMessage = string([]byte{0xff})
			case "publish result":
				input.CodexSandbox = "workspace-write"
				input.Capabilities = []string{runtimecontract.ArtifactCapability}
				wantCode = "RUNTIME_INPUT_INVALID"
			case "collect artifacts":
				input.Capabilities = []string{runtimecontract.ArtifactCapability}
			case "completion archive":
				result.SessionID = "incomplete-archive-binding"
			case "provider failure":
				result.Outcome, result.FailureCode = "FAILED", "usage_limit_exceeded"
				wantCode = "PROVIDER_RATE_LIMITED"
			case "success":
				wantCode = ""
			case "before execution":
				wantCode = "RUNTIME_INPUT_INVALID"
			}
			wantUsage := usage
			if mode == "before execution" {
				wantUsage = runtimecontract.TokenUsage{}
			}
			var mu sync.Mutex
			var receipt []byte
			attempts := 0
			server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
				if err != nil {
					t.Error(err)
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				if r.Method != http.MethodPost || r.URL.Path != "/v1/executions/lease_fixture/complete" || r.Header.Get("Authorization") != "Bearer "+strings.Repeat("c", 64) || r.Header.Get("X-Kodex-Attempt") != "3" || r.Header.Get("X-Kodex-Runtime-Revision-Digest") != input.RuntimeRevisionDigest || r.TLS == nil || len(r.TLS.PeerCertificates) != 1 {
					t.Error("completion lost authenticated execution binding")
				}
				var payload runtimecontract.RunnerCompletionRequest
				if json.Unmarshal(raw, &payload) != nil || payload.Validate() != nil || payload.Usage != wantUsage || payload.SafeErrorCode != wantCode || payload.Success != (mode == "success") || payload.RuntimeRevisionDigest != input.RuntimeRevisionDigest || payload.Attempt != input.Attempt || len(payload.Artifacts) != 0 {
					t.Error("completion lost measured usage or terminal provenance")
				}
				mu.Lock()
				defer mu.Unlock()
				attempts++
				if receipt == nil {
					receipt = append([]byte(nil), raw...)
					// Receipt уже принят; потеря ACK не должна менять расход при повторе.
					w.WriteHeader(http.StatusServiceUnavailable)
					return
				}
				if !bytes.Equal(receipt, raw) {
					t.Error("retried completion changed committed receipt")
				}
				w.WriteHeader(http.StatusNoContent)
			}))
			server.TLS = &tls.Config{MinVersion: tls.VersionTLS13, ClientAuth: tls.RequireAnyClientCert}
			server.StartTLS()
			defer server.Close()
			directory := t.TempDir()
			certificate := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw})
			privateKey, err := x509.MarshalPKCS8PrivateKey(server.TLS.Certificates[0].PrivateKey)
			if err != nil {
				t.Fatal(err)
			}
			for name, raw := range map[string][]byte{"ca.pem": certificate, "client.pem": certificate, "client.key": pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privateKey}), "ticket": []byte(strings.Repeat("c", 64))} {
				if err := os.WriteFile(filepath.Join(directory, name), raw, 0o600); err != nil {
					t.Fatal(err)
				}
			}
			input.CallbackURL = server.URL
			input.CallbackTLS = model.TLSBinding{ServerName: "127.0.0.1", CAFile: filepath.Join(directory, "ca.pem"), CertificateFile: filepath.Join(directory, "client.pem"), PrivateKeyFile: filepath.Join(directory, "client.key")}
			input.ExecutionTicketFile = filepath.Join(directory, "ticket")
			client, err := callback.New(input)
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			if mode == "before execution" {
				err = completeFailure(ctx, input, client, "RUNTIME_INPUT_INVALID")
			} else {
				err = completeExecutedTurn(ctx, input, client, result, check)
			}
			if err != nil {
				t.Fatal(err)
			}
			mu.Lock()
			defer mu.Unlock()
			if attempts != 2 || len(receipt) == 0 {
				t.Fatal("completion retry did not preserve accepted receipt")
			}
		})
	}
}

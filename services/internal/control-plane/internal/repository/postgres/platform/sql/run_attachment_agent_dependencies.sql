-- name: run_attachment_agent_dependencies :one
SELECT a.version, a.capabilities, COALESCE(i.ref, ''), COALESCE(i.digest, '')
FROM control_plane.agents a
LEFT JOIN control_plane.instruction_versions i ON i.agent_id=a.id AND i.state='PUBLISHED'
WHERE a.organization_id=@organization_id::uuid AND a.project_id=@project_id::uuid
  AND a.ref=@agent_ref

---
id: OPS-HTTP-REVISION-IMPACT-1045
title: HTTP публикация Environment с планом замен
type: operations
status: approved
owner: developer
version: 1.0.0
updated: 2026-09-05
---

Источник: #1045/#1046, MVP-UI-47, owner644/policy69 в CP89. Полная
owner-матрица находится в `revision-impact-plan-1046.md`.

| Инициатор и authority | HTTP → RPC | Переход и чтение |
| --- | --- | --- |
| Подписанный actor, текущая project.manage владельца draft | POST runtime-environment-drafts/{draftRef}/impact-plans → PrepareEnvironmentDraftImpact | If-Match VALID draft, idempotency, CSRF; 201 immutable plan без публикации |
| Тот же actor и текущая source authority | GET revision-impact-plans/{planRef} → GetRevisionImpactPlan | Query/page передаются владельцу, total после его текущей eligibility; без события |
| Явная публикация и выбор server item refs | POST draft/publication → PublishRuntimeEnvironmentDraft | Обязательный planRef и явный selectedItemRefs (0..1000), If-Match/idempotency/CSRF; atomic publication и outcomes |
| Неизвестный ответ | GET draft и GET plan | Exact published Environment revision и APPLIED plan; новый effect для восстановления не создаётся |

Старый запрос публикации без плана отклоняется до RPC, включая попытку
воспроизвести старый receipt. Его неизвестный результат восстанавливается
через прежний защищённый GetDraft. Для новых попыток клиент сохраняет
draftRef/planRef и idempotency key, но не назначает actor или authority.

Ответ публикации содержит draft, environment и plan из одной command receipt.
Gateway не заменяет его latest GET. Проверяются draftVersion+1, исходный OCC,
plan APPLIED/version2, exact target digest и опубликованная Environment
revision. Новый Environment имеет пустой source tuple; существующий — полный
immutable base tuple. SourceVersion не подменяется DraftVersion.

Get проверяет закрытые состояния, safe53 версии, refs, digest, timestamps,
ограничение1000, уникальные item refs и current total не выше plan.total.
APPLIED item сохраняет binding ref и увеличивает обе версии, ссылаясь на
опубликованную target revision. Остальные outcomes не содержат result pins.
Выбор пустого массива публикует без замен; CONFLICT/FORBIDDEN отдельного item
не отменяет уже подтверждённую публикацию.

Текущий executable registry этого checkpoint обслуживает Environment.
Общие Proto kinds Prompt/Instructions не объявляются реализованными до их
отдельного owner checkpoint. Values Environment и Secret не выдаются в impact
plan. Реальная публикация сохраняет owner events; plan/expiry читаются без
нового события через Get и durable audit/receipt.

HTTP проверки закрепляют prepare/read/publish mapping, пустой selection,
отказ старого wire, duplicate selection, неизвестные enum и подмену result
binding. Локальный exact ledger публикуется с checkpoint PR1066. Browser,
integrated protected route и deployment проверяются отдельно; fixture HTTP
не подменяет эти проверки. Секреты не раскрыты.

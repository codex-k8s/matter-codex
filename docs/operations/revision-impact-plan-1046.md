---
id: OPS-REVISION-IMPACT-1046
title: Публикация черновика с выбранными потребителями
type: operations
status: approved
owner: developer
version: 1.0.0
updated: 2026-09-05
---

# Матрица Environment

Источник: #1046, Epic #1018 и MVP-UI-47. Migration644 и policy69 зарезервированы
для владельца control-plane. Эта матрица задаёт следующий обязательный этап;
его исполняемый owner и потребители пока NOT RUN.

| Переход | Authority и точность | Результат и чтение |
| --- | --- | --- |
| PrepareEnvironmentDraftImpact | Verified actor/tenant, exact draft/project.manage до OCC; VALID draft version и повторная проверка dependency digest | Immutable actor-bound plan, source Environment/base revision, target draft version/digest, доступные текущие binding pins; новый Environment ничего не публикует |
| GetRevisionImpactPlan | Exact plan actor/tenant, текущая source authority; закрытый kind registry | Без создания плана; безопасные refs/digests, поиск, cursor и total по текущей видимости; значения Environment/Secrets не выдаются |
| Save/Discard после Prepare | Существующая draft authority/OCC | Старый plan остаётся доступным как квитанция подготовки, но не может опубликовать изменённый или discarded draft |
| PublishRuntimeEnvironmentDraft | Exact plan/draft/version/digest и server item refs; повторная admission/Secret/policy eligibility | Публикация и item outcomes в одной owner TX; пустой selection публикует без замены bindings |
| Выбранный Agent | Текущая agent.manage, exact Agent/binding/source version | Существующий фактический BindAgentRuntimeEnvironment на новую immutable версию; APPLIED receipt хранит новый binding version |
| Конфликт/отзыв | Fresh authority перед каждым item и сохранённой квитанцией | CONFLICT/FORBIDDEN сохраняют старый binding; невыбранные items NOT_SELECTED |
| Истечение | Server TTL15 минут, неизменяемая дата | EXPIRED readback; новое применение закрыто, нужен новый Prepare |
| Неизвестный ответ/replay | Durable idempotency и текущая source authority до receipt | Тот же plan/outcomes без повторной публикации или новых binding versions |

Plan ограничен1000 items. Payload не создаёт новых потребителей. Environment
использует существующие Agent bindings; Workflow/Automation получают этот
Environment через конкретного Agent, отдельные вымышленные связи не создаются.
Старые RuntimeRevision остаются неизменными. Get не возвращает полный prompt,
Environment values, Secret descriptors или скрытые foreign resources.

Prepare/expiry/final plan не создают нового domain event: authoritative Get,
command receipt и audit обеспечивают чтение результата. Реальная публикация
и изменение Agent используют существующие атомарные owner events; частичный
effect без durable outcome не допускается.

PromptTemplate и instructions включаются в тот же закрытый read registry
отдельными специализированными Prepare/Publish после интеграции owner641.
Generic metadata binding не считается заменой их фактического runtime input.

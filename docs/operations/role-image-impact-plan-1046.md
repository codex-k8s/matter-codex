---
id: OPS-ROLE-IMAGE-IMPACT-1046
title: Выборочное применение опубликованного RoleImage
type: operations
status: approved
owner: developer
version: 1.0.0
updated: 2026-09-05
---

# Граница и сценарии

Источники: #1046, #1018, CFG/MVP-UI-42/47 и
`role-image-managed-lifecycle-1046.md`. Publication recipe запускает сборку;
применение образа является отдельной операцией после admission/promotion.
План не обещает конкретный image digest до завершённого build/promotion.
Generic metadata binding не считается применением RoleImage.

| Сценарий | Authority и точность | Owner переход и readback |
| --- | --- | --- |
| Prepare | Verified actor → specialized PrepareRoleImageImpactPlan, actual project image.build; set/revision разрешаются до OCC/idempotency | Назначенные server ref/version/TTL, immutable mapping revision→recipe generation/build→promoted artifact и current policy; исходные Environment/Agent bindings зафиксированы до применения |
| Повтор Prepare | Тот же actor/tenant/idempotency и exact input; текущая source authority | Та же квитанция, без пересчёта immutable item set; изменённый input закрывается |
| Get/search/page | Verified actor → GetRoleImageImpactPlan, exact owner/tenant и текущая image/source permission | Read-only, никакого скрытого создания плана; cursor связан с actor/plan/version/query, literal query и authoritative total |
| Apply | Existing RebindRoleImageConsumers с planRef и selectedItemRefs, set OCC и digest плана | PREPARED→APPLIED в одной owner TX; legacy metadata-only consumers для RoleImage не допускаются |
| Environment item | Текущая project.manage, exact setVersion/sourceVersion/digest, повторный current artifact admission | Новая immutable EnvironmentVersion со всеми прежними values/Secret revision pins/tools/policy и новым image; прежняя версия неизменна |
| Agent item | Environment authority плюс текущая agent.manage и exact agent/binding versions | Создаётся/переиспользуется новая версия выбранного source Environment, изменяется только выбранный binding; будущий turn получает свежую RuntimeRevision |
| Stale item | Environment либо Agent/binding OCC изменился после Prepare | Только этот item CONFLICT, соседние независимые items сохраняют свои результаты; частичный effect без receipt запрещён |
| Отзыв item authority | Текущая source/consumer eligibility перед effect | FORBIDDEN без раскрытия новых metadata; ни idempotency, ни старый plan не заменяют permission |
| Не выбран | Item не входит в выбранные server refs | NOT_SELECTED, отсутствуют Environment/binding effects |
| Истечение | Server expiresAt, PREPARED ещё не применён | EXPIRED, применение закрыто; новый Prepare получает новый snapshot, старые receipts сохраняются |
| Потеря ответа/replay | Durable command receipt и текущая authority до выдачи | Возвращаются прежние APPLIED outcomes; новые Environment versions не создаются повторно |
| Admission/policy отозван | Current policy/runtime ABI/admission не совпадает с pin | До эффектов закрытый отказ; старые immutable RuntimeRevision не переписываются |

Plan ограничен 1000 items и 15 минутами. Public DTO содержит только safe refs,
versions/digests, outcomes и result refs. Private Environment values и Secret
locators не входят в план. APPLIED item указывает новую Environment version;
agent item дополнительно указывает тот же binding ref с возросшей version.
Один source Environment клонируется не более одного раза внутри применения.

Prepare, expiry и final plan не публикуют новый domain event: authoritative
GetRoleImageImpactPlan и command receipt/audit являются readback. Реальная
публикация Environment использует существующий атомарный domain event и его
cardinality; selective binding использует существующий owner transition.
Gateway/PWA читают nonterminal plan через bounded polling.

# Статус реализации

Контракт подготовлен; owner migration643, SQL/producer, policy68 и consumer
ещё NOT RUN. Этот документ фиксирует полную lifecycle-матрицу до реализации,
а не заявляет завершение функции. Полные prepublication планы других видов
Environment/Prompt/Instructions остаются отдельными обязательными сценариями
того же unit.

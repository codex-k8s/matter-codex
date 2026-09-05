---
id: OPS-VFS-ELIGIBILITY-1046
title: Виртуальные файлы и авторитетная доступность
type: operations
status: approved
owner: developer
version: 1.0.0
updated: 2026-09-05
---

# Карта MVP-UI-37/61

Вклад в полный CP unit #1046, Epic #1018. VFS path — только адрес проекции;
из него нельзя получать authority или storage key.

| Сценарий | Инициатор, контракт и владелец | Переход, точность и потребитель |
| --- | --- | --- |
| Дерево/поиск | Verified actor → HTTP VFS → ListVFSNodes/SearchVFS → CP RR transaction; текущие catalog_resource_visible/Skill/Memory rules | Read-only; scope/path/query/lifecycle/kind привязаны к cursor; SQL eligibility до LIMIT и count; typed source/ref/version/revision/scan/actions для PWA |
| Одиночный Artifact | Verified actor → GetArtifact → тот же artifact.view и exact target | Read-only; authorityProject и свежие bindings; actions вычисляются по отдельным permission, не legacy role |
| Скачивание/preview | Verified actor → DownloadArtifact → artifact.view + artifact.download в owner transaction | Exact content grant, audit и consume сохраняются; resource-instance role работает без legacy membership, отзыв закрывает доступ |
| Run/graph/event/receipt | Проверенный actor → read model либо повтор команды → текущая batch eligibility Artifact | Скрытые refs и metadata удаляются из ответа; историческая версия не получает actions текущей версии. Sequence/event history не переписываются |
| Множественный выбор | PWA сохраняет exact refs/revisions/version выбранных строк; существующие специализированные Artifact/Skill/Memory commands | Owner повторно проверяет authority до OCC/receipt; каждая строка имеет явный результат, отказ не игнорируется; irreversible purge использует существующий impact |
| Archive/delete/restore/purge | Только соответствующий типизированный owner command | Исторические immutable runtime inputs не меняются; tombstone/read paths и текущие audit/event invariants сохраняются |
| Runtime MCP | RuntimeRevision/lease/grant server context → специальные bounded search/metadata/preview/manifest operations | Только exact разрешённые revisions; ни путь, ни client projectRef не расширяет snapshot. Consumer/controller ещё подлежит реализации и проверке |

Дерево показывает только применимые папки после eligibility. Skills, Memory,
обычные артефакты и immutable run inputs имеют разные типы; отсутствие
полномочий либо недопустимый lifecycle задаёт причину недоступного выбора.
Query/count/page исполняются в одной ограниченной транзакции. События чтения
не создаются: authoritative GET/List являются readback. Runtime MCP audit
не содержит полного query/content, credentials или transcript.

Context7 `/jackc/pgx`: BeginTx, read-only RepeatableRead, StrictNamedArgs,
Close/Rollback и отмена context проверены. Targeted race, vet/build и полный
disposable PostgreSQL Bootstrap проверяют текущую реализацию; exact checkpoint
и результаты фиксируются следующим документационным commit.

Это вклад в незавершённый unit. Дополнение иерархии, полный Runtime MCP producer
и consumer, HTTP/SDK/PWA новых полей, live/runtime acceptance — NOT RUN.
Документ не объявляет MVP-UI-37/61 полностью выполненными.

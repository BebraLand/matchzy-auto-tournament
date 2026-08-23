# Broadcast camera roadmap

Статус: идея на потом, не реализовано.

## Задумка

Сделать production-friendly broadcast camera layer для CS2-трансляций:

- auto-director, который выбирает интересные игровые моменты;
- automatic aerial / overview view для вступлений, переходов и пауз;
- HLAE cinematic cameras для заранее подготовленных пролётов, интро, map reveal и post-match сцен;
- ручной operator override, чтобы режиссёр мог в любой момент забрать управление;
- безопасное разделение live gameplay cameras и заранее записанных cinematic shots.

## Важные ограничения

- Не менять текущий default HUD без отдельного согласования.
- MAT остаётся источником истины для match/tournament state.
- Камеры и режиссура должны использовать read-only broadcast feed.
- HLAE-сцены должны быть отдельным production tool/workflow, а не частью RCON/control plane.
- Для live-матчей нужен надёжный manual fallback.

## Когда вернёмся к задаче

1. Описать camera states: pre-match, veto, live, clutch, round end, map end, series end.
2. Проверить реальные ограничения CS2 spectator/GSI/MatchZy.
3. Спроектировать auto-director scoring и operator override.
4. Отдельно подготовить HLAE shot list и map-specific camera paths.
5. Сделать isolated prototype и проверить через OBS Browser Source/recorded feed.
6. Только после просмотра прототипа подключать MAT/JTs-Hud.

## Отдельный HUD backlog

Добавить в собственный broadcast HUD real-time player webcams с информацией:

- player webcam/video feed;
- display name;
- first name and surname;
- country flag/country code;
- team, role и live player state при необходимости.

Нужен отдельный HUD settings/configuration layer, чтобы настраивать:

- включение и выключение webcam blocks;
- layout и позиции карточек;
- размер и crop webcam;
- порядок и состав player fields;
- отображение country flag;
- typography, colors, spacing и team-color accents;
- fallback, если webcam или player metadata отсутствуют;
- разные layouts для 16:9, vertical и compact scenes.

## Архитектурная граница

- MAT остаётся authoritative source для player identity, display name, first name, surname, country, team и role.
- HUD получает эти данные через read-only broadcast projection.
- Webcam transport/storage и rendering остаются в broadcast/HUD layer.
- Нельзя делать live player webcam URLs или HUD settings частью RCON/control plane.
- Для каждой карточки нужен graceful fallback без webcam и без country metadata.

## Принятые решения для первой версии auto-director

- Первая версия работает только в first-person и всегда следует за конкретным игроком.
- Overview, freecam, aerial и cinematic camera modes остаются следующими этапами.
- Основной camera-control transport: CS2 Telnet; Windows key simulation используется как резервный adapter.
- Реализация ведётся отдельно в JTs-Hud в isolated experimental branch/worktree и не смешивается с MAT или основной MAT integration branch до отдельного одобрения.

Режимы поведения:

- `Balanced` (default): одновременно реагирует на экшен и сохраняет понятное развитие раунда;
- `Reactive`: быстрее переключается на непосредственный контакт, урон и objective action;
- `Calm / Storytelling`: дольше удерживает выбранного игрока и меняет POV только при существенном преимуществе другого кандидата.

Начальные безопасные defaults, которые затем проверяются на demo replay:

- Balanced minimum dwell: 2.5 seconds;
- Reactive minimum dwell: 1.25 seconds;
- Calm minimum dwell: 4 seconds;
- после kill удерживать POV примерно 1.2 seconds, если игрок жив и нет более сильного objective event;
- plant и defuse получают hard lock до завершения, отмены или смерти игрока;
- активная перестрелка получает короткий soft lock, чтобы камера не ушла между первым выстрелом и разменом;
- смерть наблюдаемого игрока снимает lock немедленно;
- обычное переключение разрешается только при заметном преимуществе нового кандидата, чтобы избежать camera ping-pong;
- manual operator override всегда сильнее automation.

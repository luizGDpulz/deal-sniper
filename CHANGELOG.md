# Changelog

Todas as alterações notáveis deste projeto são documentadas neste arquivo.
O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

---

## [Não lançado]

---

## [0.1.0] - 2026-11-17

### 🚀 Adicionado
- Arquitetura single-process em TypeScript + Node.js 24 LTS (`pnpm`) combinando listener passivo MTProto (`GramJS`) e control plane (`grammY`) (#1, #4).
- Persistência em SQLite nativo (`node:sqlite` + `drizzle-orm/sqlite-proxy`) com `WAL` mode e Soft Delete (`deletedAt`) em regras e fontes (#1).
- Middleware de autorização estrita por `ALLOWED_USER_IDS` e `ALLOWED_CHAT_ID` com drop silencioso (#2).
- Resolvedor de URLs encurtadas SSRF-safe bloqueando IPs privados, loopback, CGNAT, metadata (`169.254.169.254`) e IPv4-mapped IPv6, além de remoção de parâmetros de rastreio (#2).
- Parser heurístico de preços em BRL (priorizando Pix/à vista vs. parcelamento total e extração de cupom), matcher com blacklist/ReDoS guard e deduplicação por hash + URL dentro de TTL (#3).
- Sincronização de canais do Telegram com suporte a filtro por Pasta (`TELEGRAM_FOLDER_NAME`) e comandos topic-aware (`/watch`, `/list`, `/unwatch`, `/ignore`, `/unignore`, `/sources`, `/toggle`, `/sync`, `/status`) (#4).
- `Dockerfile` multi-stage hardened não-root (`USER node`), `compose.yml` sem portas expostas (`read_only`, `cap_drop: ALL`) e pipeline GHCR multi-arch (`linux/amd64`, `linux/arm64`) (#5).
- Logo vetorial customizada (`assets/logo.svg`) e `README.md` estruturado para portfólio e self-hosting (#6).

[Não lançado]: https://github.com/luizGDpulz/deal-sniper/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/luizGDpulz/deal-sniper/releases/tag/v0.1.0

# Кубок России U16 — LIVE gateway

Cloudflare Worker source and deployment notes for the official FHR 2026/27 tournament.

Official calendar: https://junior.fhr.ru/tournaments/kubokrossii-25008909/calendar/

**Status:** deployment and real-time match feed are not yet verified. A final score in the calendar is not proof that a match is live.


Deployment workflow is configured. A push to `main` triggers Cloudflare deployment when repository secrets are present.

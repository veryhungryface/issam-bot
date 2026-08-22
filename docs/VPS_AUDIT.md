# VPS audit — 2026-08-22

Read-only audit preceded all deployment changes.

| Item | Result |
| --- | --- |
| OS | Ubuntu 20.04.6 LTS |
| CPU | 1 vCPU, x86_64 |
| Memory | 1.9 GiB RAM, 1 GiB swap |
| Disk | 29 GiB total, 22 GiB free |
| Initial services | SSH, containerd, cron, system services; no container workloads |
| Network | SSH on TCP 22; no application listener |

## Changes approved after the audit

- Created the `deploy` account and verified SSH public-key login.
- Installed UFW, fail2ban, unattended-upgrades, Docker Engine, and Docker Compose.
- Disabled SSH root and password authentication after the deploy-key verification.
- Allowed only TCP 22, 80, and 443 at the host firewall.

No Chrome, Xvfb, VNC, or other GUI runtime is installed or permitted on this VPS.

## Capacity decision

This is a 2 GB profile. It may run a small API, worker, and reverse proxy only. PostgreSQL, object storage, Chrome, model inference, and frontend image builds must remain external/CI-hosted.

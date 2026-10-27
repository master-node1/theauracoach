# Architecture Diagrams

C4-style views in Mermaid. Narrative lives in the [HLD](HLD.md).

## 1. Containers

```mermaid
flowchart TB
  subgraph Clients
    mob[Expo app<br/>iOS / Android]
    web[Next.js web<br/>user + admin + BFF]
  end
  subgraph aws["AWS ap-south-1 · k3s on EC2 (beta) / EKS (growth)"]
    cf[CloudFront + WAF]
    alb[Ingress<br/>Traefik on k3s · ALB on EKS]
    gw[api-gateway<br/>nginx]
    prof[profile-service]
    wo[workout-service]
    nu[nutrition-service]
    pr[progress-service]
    co[coach-service]
    nt[notification-service]
    au[audit-service]
    bus[(Redis Streams<br/>event bus)]
    pg[(RDS PostgreSQL 16<br/>database per service)]
    s3[(S3 media)]
  end
  cog[Cognito]
  llm[Anthropic API]
  off[Open Food Facts]
  push[Expo Push · SES]

  mob --> cf
  web --> cf
  cf --> alb --> gw
  alb --> web
  mob -. OAuth PKCE .-> cog
  web -. OAuth PKCE .-> cog
  gw --> prof & wo & nu & pr & co & nt & au
  prof & wo & nu & pr & co & nt --> bus
  bus --> au
  prof & wo & nu & pr & co & nt & au --> pg
  wo --> s3
  co --> llm
  nu --> off
  nt --> push
```

## 2. Inside one service

Every NestJS service has the same shape, built from `packages/service-kit`:

```mermaid
flowchart LR
  subgraph svc[workout-service]
    direction TB
    http[HTTP app<br/>public /v1 + /internal/v1]
    g[Guards: JwtAuth, InternalService, Permissions, Consent, RateLimit]
    app[Application services]
    eng[[packages/domain engines]]
    repo[Prisma repositories]
    ob[(OutboxEvent)]
    relay[Outbox relay]
    cons[Event consumers]
    jobs[BullMQ jobs]
  end
  http --> g --> app
  app --> eng
  app --> repo --> db[(workout_db)]
  app --> ob
  relay --> ob
  relay --> bus[(Redis Streams)]
  bus --> cons --> app
  jobs --> app
```

The `http` process and the `worker` process (relay, consumers, jobs) run from the same image as separate Helm deployments.

## 3. Coach tool-call sequence

```mermaid
sequenceDiagram
  participant C as Client
  participant Ctl as CoachController
  participant Orc as CoachOrchestrator
  participant Saf as SafetyService
  participant Gw as AiGateway
  participant P as Provider adapter
  participant T as ToolExecutor
  participant Svc as Owning service<br/>(workout / nutrition / progress)
  C->>Ctl: POST message (SSE)
  Ctl->>Orc: handle(ctx{userId}, text)
  Orc->>Saf: precheck(text)
  alt red flag
    Saf-->>Orc: escalate(template)
    Orc-->>C: safety response + flag
  else ok
    Orc->>Gw: run(prompt, tools, budget)
    loop until end_turn or max 6 tool rounds
      Gw->>P: messages + tools
      P-->>Gw: tool_use(name, input)
      Gw->>T: execute(ctx, name, input)
      T->>T: zod validate, authz, rate
      T->>Svc: GET/POST /internal/v1/... (service JWT, sub_user = ctx.userId)
      Svc-->>T: minimal DTO
      T-->>Gw: tool_result
    end
    Gw-->>Orc: final text + usage
    Orc->>Saf: postcheck(text)
    Orc-->>C: stream text + proposals
  end
```

## 4. Deployment

See [deployment-architecture.md](deployment-architecture.md).

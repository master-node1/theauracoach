# Architecture Diagrams

C4-style views in Mermaid. Narrative lives in the [HLD](HLD.md).

## 1. Containers

```mermaid
flowchart TB
  subgraph Clients
    mob[Expo app<br/>iOS / Android]
    web[Next.js web<br/>user + admin + BFF]
  end
  subgraph AWS ap-south-1
    cf[CloudFront + WAF]
    alb[ALB]
    api[api<br/>NestJS REST + SSE]
    wrk[worker<br/>NestJS BullMQ consumers]
    pg[(RDS PostgreSQL 16<br/>Multi-AZ)]
    rd[(ElastiCache Redis 7)]
    s3[(S3 media<br/>public-cdn / private-user)]
    cog[Cognito user pool]
    sm[Secrets Manager / KMS]
  end
  ext1[Anthropic API]
  ext2[Open Food Facts]
  ext3[Expo Push → APNs/FCM]
  ext4[SES]

  mob --> cf
  web --> cf
  cf --> alb
  alb --> web
  alb --> api
  mob -. OAuth PKCE .-> cog
  web -. OAuth PKCE .-> cog
  api --> pg
  api --> rd
  api --> s3
  api --> ext1
  api --> ext2
  wrk --> pg
  wrk --> rd
  wrk --> ext1
  wrk --> ext3
  wrk --> ext4
  api --> sm
  wrk --> sm
```

## 2. API components

```mermaid
flowchart LR
  subgraph api[apps/api]
    direction TB
    g[Guards: JwtAuth, Roles, RateLimit, Consent]
    subgraph modules
      id[identity]
      us[users]
      on[onboarding]
      wo[workouts]
      nu[nutrition]
      pr[progress]
      co[coach]
      ag[ai-gateway]
      no[notifications]
      ad[admin]
      au[audit]
    end
    bus[(in-process event bus)]
  end
  dom[[packages/domain<br/>pure engines]]
  con[[packages/contracts<br/>Zod schemas]]
  on --> wo & nu
  co --> ag
  co --> wo & nu & pr & us
  wo --> dom
  nu --> dom
  pr --> dom
  modules --> con
  wo -- WorkoutCompleted --> bus
  nu -- MealLogged --> bus
  bus --> pr & no & au
```

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
  participant Svc as Domain services
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
      T->>Svc: call with ctx.userId
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

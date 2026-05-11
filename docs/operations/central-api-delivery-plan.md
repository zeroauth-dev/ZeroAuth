# Central API Delivery Plan

This plan translates the attached `ZeroAuth_7_Week_Demo_Execution_Plan.pdf` into a build sequence for the repo as it exists on **May 11, 2026**, which is **Day 1 of Week 1**.

## Current State

The repo already has part of the Week 1 foundation:

- tenant signup and login
- API-key creation, listing, and revocation
- versioned `/v1` routing
- ZKP, SAML, OIDC, and identity endpoints
- hosted docs, dashboard, and landing site
- Docker and Caddy deployment scaffolding

The main gaps before this work were:

- no reusable device model
- no reusable enrolled-user model
- no reusable verification event store for demos
- no attendance event model
- no business audit log surfaced through the tenant console
- no Week 1 delivery plan documented against the actual codebase

## What Week 1 Must Mean

By **May 17, 2026**, the goal is not “more auth endpoints.” The goal is a reusable product core that every future demo calls.

Definition of done for Week 1:

1. `zeroauth.dev` exposes a single central API for tenants, keys, devices, users, verifications, attendance, and audit.
2. Every write surface is tenant-scoped and environment-scoped.
3. Developer docs show how to sign up, mint keys, register a device, create a user, log a verification, and log attendance.
4. The console has an overview payload that can drive a simple Week 1 dashboard/viewer.
5. The API contract is frozen enough for Week 2 IoT work to proceed in parallel.

## Review Findings That Change the Plan

These findings affect execution order:

1. The repo already had the beginning of a central control plane, so the fastest path is to extend it rather than rebuild it.
2. The current SAML and OIDC flows are still scaffold-level. They should not be treated as the Week 1 demo backbone.
3. ZKP verification currently falls back to structural proof validation if the verification key is missing. That is acceptable for local dev but should not be the hidden assumption for external demos.
4. The repo contained a production-credentials document with live operational detail. Secret hygiene has to be treated as part of Week 1 hardening, not an afterthought.

## Build Plan

### Week 1: May 11 to May 17, 2026

Primary outcome:

- central API live and documented

Build order:

1. Freeze the data model.
   - tenants and API keys stay as the control plane
   - add devices, tenant users, verification events, attendance events, and audit events
   - keep `live` and `test` environments separated by API-key environment

2. Freeze the API contract.
   - `/api/console/signup`
   - `/api/console/login`
   - `/api/console/keys`
   - `/api/console/usage`
   - `/api/console/overview`
   - `/v1/devices`
   - `/v1/users`
   - `/v1/verifications`
   - `/v1/attendance`
   - `/v1/audit`

3. Freeze the Week 2 device interaction loop.
   - create device
   - create enrolled user
   - submit verification result
   - record attendance event
   - view result in overview and audit history

4. Freeze docs and examples.
   - central API reference
   - quickstart flow
   - one curl sequence for the IoT demo

Suggested day-by-day split:

- **May 11:** schema, scopes, route contracts, docs skeleton
- **May 12:** devices and users endpoints
- **May 13:** verifications and attendance endpoints
- **May 14:** audit log and console overview
- **May 15:** integration examples, docs, quickstart polish
- **May 16:** test pass, staging deploy, seed demo data
- **May 17:** full demo run and issue triage

Week 1 backlog that should stay out:

- billing
- advanced admin roles
- analytics dashboards
- multi-region infra
- deep compliance workflows
- polished SDKs in multiple languages

### Week 2: May 18 to May 24, 2026

Primary outcome:

- battery-powered attendance prototype sends real events into the central API

Workstreams:

- device firmware calls `/v1/verifications`
- device posts `/v1/attendance`
- dashboard/overview confirms check-in and check-out visibility
- create one fixed demo script using one test tenant and one live tenant

### Week 3: May 25 to May 31, 2026

Primary outcome:

- one non-IoT wrapper demo built on the same API

Choice rule:

- pick one of insurance, crypto, or hospital
- do not fork the backend
- only change wrapper UI, metadata, and storyline

### Week 4: June 1 to June 7, 2026

Primary outcome:

- repeated demo reliability

Required output:

- 20 to 30 full demo runs
- issue list with severity
- conscious accept/fix/defer decisions

### Week 5: June 8 to June 14, 2026

Primary outcome:

- 2 to 3 additional lightweight wrappers and outreach assets

Strict rule:

- wrappers only
- no new backend product line
- central API contract stays stable

### Week 6: June 15 to June 21, 2026

Primary outcome:

- live demos and objection tracking

Data to capture:

- which objections block follow-up
- which fields or audit views buyers ask to see
- which wrappers resonate enough to justify Week 8 to Week 10 work

### Week 7: June 22 to June 28, 2026

Primary outcome:

- fix demo blockers and package a 90-day PoC

Required outputs:

- stable demo build
- second-meeting assets
- one PoC proposal
- updated FAQ/demo library

## What Was Implemented In This Pass

This repo pass adds the missing Week 1 backend core:

- device registration and updates
- enrolled user creation and updates
- verification event recording
- attendance event recording
- tenant-scoped audit log
- console overview endpoint for a Week 1 viewer
- central API documentation

## Immediate Next Steps

1. Deploy this version to staging or production-like infrastructure and validate schema creation.
2. Connect the first demo client to the new `/v1/devices`, `/v1/users`, `/v1/verifications`, and `/v1/attendance` flow.
3. Add one simple dashboard screen that reads `/api/console/overview?environment=live`.
4. Decide whether the first Week 3 wrapper is insurance, crypto, or hospital, but do not change the central API for it unless a genuine shared requirement appears.

## Non-Negotiable Rule

For the next 7 weeks, the question for every feature request should be:

“Does this strengthen the shared ZeroAuth core, or is it just a one-off demo convenience?”

If it is only a one-off convenience, it belongs in the wrapper, not the platform.

# GitHub Signal Studio

## Purpose

The Social Studio will not make content *about* repository README files. It will
find unusual projects, test a narrow claim in an isolated environment, and hand
the Board an evidence pack that can become a truthful short-form video.

The unit of work is a **project proof**, not an employee conversation.

```text
Discover -> shortlist -> approve a trial -> isolate -> reproduce one claim
    -> review evidence -> capture source material -> Board decides -> edit
```

This is a project studio. The named Social agents are durable accountabilities,
not five always-running model processes.

## Existing open-source building blocks

Northstar should compose these tools rather than recreate their internals.

| Need | Adopted component | Northstar's thin responsibility |
| --- | --- | --- |
| Discovery | GitHub search/trending snapshots and a Board watchlist | Collect metadata, deduplicate it, and score candidate cards. |
| Persistent producer | Hermes Agent | Wake on the schedule, retain a scoped editorial memory, and request work. |
| High-quality verification | Broker-owned Codex CLI | Turn a claim contract into a bounded investigation and report evidence. |
| Isolated trials | Disposable Docker or a stronger sandbox runtime | Create a non-privileged, no-host-mount workspace and destroy it after the trial. |
| Browser proof | Playwright / Playwright CLI | Reproduce a web flow and save screenshots, traces, and a video. |
| Terminal proof | Charmbracelet VHS or asciinema | Produce deliberate, redacted command-line clips; never record an unedited live terminal. |
| Production handoff | OpenMontage | Compose verified media into a video only after the project-proof gate passes. |

OpenMontage is deliberately downstream. Its Screen Demo and composition
pipelines are useful for turning a passed proof into editable media, but a
beautiful montage is not evidence that an upstream project works. Its AGPL-3.0
license also means it should be used as a separate local tool, rather than
copied into Northstar without a deliberate licensing decision.

## Two-day cycle

### 1. Scout: metadata only

Iris pulls a bounded candidate pool from GitHub's recent repository search,
Trending snapshots, release feeds, and a Board watchlist. The Scout does not
clone or run projects. It creates a candidate card containing:

- source URL, owner, license, commit SHA, activity, and a one-line claim;
- why the idea is surprising, not merely popular;
- a proposed 15–45 second visual hook;
- one testable README claim;
- setup complexity and likely external dependencies;
- a preliminary security, cost, and rights assessment.

Stars are an input, not proof of quality or originality. The system should
especially surface small, early projects with a clear, testable idea.

### 2. Producer: choose the smallest proof

Mira narrows the batch to no more than two trials. A trial begins only with a
written claim contract:

```text
Claim:        "The project can turn X into Y locally."
Commit:       full SHA to test
Observable:   exactly what counts as success on screen
Limits:       time, compute, allowed domains, no external publication
Credentials:  named capability only; no raw secret in the repository
Evidence:     logs, screenshots, test video, report
```

If the claim is vague, the candidate is not ready for a trial.

### 3. Verifier: disposable sandbox

Theo requests a trial through the Northstar Broker. The Broker, not Hermes or
the cloned project, owns Codex authentication and any service credential. The
trial starts in an empty Linux workspace with no home-directory mount, no
privileged mode, no host networking, and a strict time/disk/memory limit.

The first run receives no secrets. A narrowly scoped provider key can be
injected only after the project clearly demonstrates why it is necessary and
the Board grants that capability. Never place a personal, browser, GitHub,
Codex, or social-media credential in a downloaded repository's `.env` file.

The verifier's job is not to force a green result. It may return:

- **passed** — the narrow claim is reproduced;
- **partial** — a visible portion works, with material limits stated;
- **failed** — the claim could not be reproduced;
- **unsafe / blocked** — the project needs a higher-risk capability.

A failed trial is still useful content research, but it cannot be described as
a successful demo.

### 4. Independent editorial review

Sage reviews the evidence without rewriting it. The review scores novelty,
visual pull, truthfulness, setup friction, rights, and whether a human editor
could make a compelling clip from the actual result.

### 5. Capture and handoff

Lyra creates a shot list from the passed evidence:

- a short browser or desktop recording of the real result;
- a clean, scripted terminal clip showing only the meaningful command path;
- screenshots of the before/after state;
- a concise fact sheet naming what was verified, what was not, and the source;
- source and license notes for every asset.

OpenMontage can then use the Board's template to create a rough composition or
additional B-roll. The user remains the editor and retains the release decision.

## Authority and safety gates

| Action | Default | Authority required |
| --- | --- | --- |
| Read public GitHub metadata | Allowed | Scout / scheduled workflow |
| Clone a repository | Allowed only into a disposable sandbox | Broker after metadata gate |
| Run install/build/test commands | Allowed only in sandbox | Broker after claim contract |
| Inject a metered provider key | Blocked | Board-scoped capability |
| Browser login, OAuth, webhook, public tunnel | Blocked | Board-scoped capability |
| Generate media from verified evidence | Proposed only | Board template + approval |
| Post, message, spend, subscribe, or publish | Blocked | Separate Board approval and capability gateway |

## V0 success metric

After one cycle, the system should be able to give the Board three candidate
cards and one project-proof pack. It has succeeded only if a human editor can
truthfully cut a short video from the delivered artifacts without reopening the
repository or trusting a README.

The next implementation milestone is a local **metadata collector + mock
project-proof runner**. It remains keyless and non-network-destructive. Real
GitHub API access, sandbox provisioning, provider keys, and OpenMontage handoff
will be added as separately scoped adapters after their capability gates are
tested.

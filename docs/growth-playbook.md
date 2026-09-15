# agent-hands growth playbook

Written 15 Sep 2026. Baseline numbers are from that day. Re-measure before
acting on any of them.

<!-- INDEX
L18   0. Where it stands
L46   1. The positioning decision
L114  2. What the research says works
L202  3. The plan: first week, first month, first quarter
L337  4. Channels, ranked for this tool
L359  5. Artifacts to make, with specs
L411  6. Measurement, weekly
L434  7. Rules
L452  8. Sources
-->

## 0. Where it stands

| Metric, 15 Sep 2026 | agent-hands | agent-browser |
|---|---|---|
| GitHub stars | 0 | 42,582 |
| npm downloads, last week | 198 | 1,070,795 |
| skills.sh installs | not listed | 854,100 |
| GitHub visitors, 14 days | 2 unique | n/a |
| GitHub topics | none | n/a |
| README hero visual | none | none |
| Third-party plugins on npm | n/a | 1 (`agent-browser-plugin-cloak`) |

The 198 weekly downloads are the owner's own installs plus registry mirrors.
No page on the web mentions agent-hands. No GitHub repo outside the author's
installs it. The tool is unknown.

The neighbour is enormous and its users are the target audience. Every
agent-browser user who drives a real account is a potential agent-hands user.
The plan below treats agent-browser's rooms as the first place to be seen, and
its plugin system as the first integration.

Two facts about the code base matter for growth and were fixed today:

- A fresh machine could not run the CLI without agent-win and agent-browser.
  Fixed in 0.17.1 (`HANDOFF.md`, "Fixed 15 Sep 2026").
- The README opened with "Hands for agent-browser". It now opens with "human-rate
  hands for a real Chromium browser". Section 1 says why that matters.

## 1. The positioning decision

Three things in the agent-browser repo change the pitch.

**PR #1810 adds curved mouse movement to agent-browser itself.** Opened
7 Sep 2026 by petehunt. It adds `--human` on `click` and `drag`,
`--input-mode instant|smooth|human` per session, and `--duration`, `--steps`,
`--seed` on `mouse move`. The maintainer (ctate) requested changes on
11 Sep for a bug (the flag became sticky), not on the idea. Expect it to
merge. Scope is mouse only: no keystroke timing, no scroll bursts, no
Fitts-law durations, no overshoot, no reaction pause. Source:
https://github.com/vercel-labs/agent-browser/pull/1810

**Issue #120 shows what the community accepts.** "Add stealth mode", open
since 15 Jan 2026, 13 comments, still open. Every answer that stuck was a
separate companion tool posted into the thread with evidence: an MCP server
(trogocytosis), a nodriver-based server with a video of it passing
Cloudflare Turnstile, and CloakBrowser through CDP mode. The phrasing that
landed was "works alongside agent-browser, not a replacement". Source:
https://github.com/vercel-labs/agent-browser/issues/120

**The plugin system is empty.** Added 16 Jun 2026 (#1452). Capabilities:
`launch.mutate` (extra Chrome args, extensions, init scripts before launch),
`command.run` (custom verbs via `agent-browser plugin run <name> <type>`),
`browser.provider`, `credential.read`. Package convention
`agent-browser-plugin-<name>`. One third-party plugin exists on npm. The docs
live in the repo (`docs/src/app/plugins/page.mdx`) and outside contributors
have had provider pages merged (#928, #1648). Source:
https://agent-browser.dev/plugins

**Decision.** Stop selling "human-like mouse for agent-browser sessions".
agent-browser will have that natively. Sell the three things agent-browser
cannot do for a user's real account:

1. **It drives the browser you are already logged into.** Chrome and Edge
   144+ expose debugging from `chrome://inspect` with no relaunch.
   agent-hands attaches there, holds one approved socket in a relay, remembers
   the tab, refuses to type into a sign-in page while flagged, and writes an
   audit line per command. agent-browser cannot attach to a browser it did
   not start.
2. **It models the whole gesture, not the path.** Fitts-law duration,
   overshoot and correction, lognormal keystroke dwell and flight, wheel-burst
   scrolling, a reaction pause after a wait. Measured against human ranges
   and printed in the README.
3. **It refuses when a click would be wrong.** Covered target, form container
   instead of a field, credentials in argv, sign-in page with
   `navigator.webdriver` set. Each refusal names the fix. On an account that
   can be banned, a refusal is worth more than a click.

**Other rooms are asking the same question.** OpenClaw (380k stars) has an
open issue asking for Patchright as a "drop-in browser backend (stealth
mode)" (openclaw/openclaw#52190). Patchright itself reached 200K weekly
downloads with no launch at all: it was pulled in as a dependency because
users asked bigger tools to support it. Stagehand's docs added a CloakBrowser
stealth example the same way (#1947). The pattern is: a small tool that fixes
a named failure gets requested as infrastructure inside the big tools.

The one-line pitch: **Human-rate hands for the browser you are logged into.**

The audience: people who run Claude Code, Codex or Cursor against accounts
that can be banned. SEO tools, ad platforms, marketplaces, banking, social,
CRM. The owner is one of them; write for that person.

What to do about the comparison table in the README: keep it, and when #1810
merges, re-measure agent-browser `--human` with the same event trace and
update the rows honestly. If the mouse row ties, say so. The other rows and
the "your own browser" row are the argument.

## 2. What the research says works

Rules with evidence, from the literature and from the tools studied. Full
citations in section 8.

**Repo and README**

- A README converts in about 30 seconds: one sentence, a visual above the
  fold, a one-command install, a quick start. Five prerequisites and most
  visitors bounce. agent-hands now has the install and quick start; it has no
  visual.
- The repo description is the highest-leverage metadata field. GitHub ranks on
  it and Google shows it. Add 5 to 15 topics. agent-hands has none.
- A comparison table works with three columns and three rows that actually
  differ.
- Stars and downloads correlate weakly. Track both, separately. Downloads are
  the real signal.
- GitHub Trending ranks on star velocity against the repo's own baseline. A
  small repo can trend on a good day.

**Launch mechanics**

- Show HN: 2.3% of submissions reach the front page. About 1.4 stars per
  upvote, and 92% of the bump is gone in 48 hours. Title format
  "Show HN: Name – one specific line". Best window Monday 00:00 UTC. Treat it
  as a spike, once, after the README has a visual and two outside users.
- Reddit: at most one promotional post in ten. Put the link in the first
  comment. Never the same link in several subreddits the same day.
- Comparison pages convert at 6 to 9% against 2 to 3% for ordinary keywords.
  Put a verdict at the top.
- Content ROI takes 6 to 12 months. One good article beats 25 mediocre ones.
- Getting cited in a bigger tool's docs follows from integrating with it, not
  from asking.

**Developer marketing doctrine**

- Lead with features and measurements. Developers read "easy" and "simple" as
  noise.
- Write down the objections and answer them in the docs. For agent-hands the
  objections are: "is this really undetectable" (no, and say so), "why not
  ghost-cursor", "does it work on Mac", "does it need agent-browser".
- Build an owned channel early. For a solo project GitHub Discussions plus
  release notes is enough.
- Add "where did you hear about it" to the issue template.

**Analogues in this niche** (case studies, 15 Sep 2026)

- ghost-cursor, the closest analogue (Bezier mouse paths for Puppeteer), sits
  at 1.6k stars and 62K to 89K weekly downloads. It was never launched. It was
  bundled into `puppeteer-real-browser` as `page.realCursor` and paired with
  puppeteer-extra-stealth in every tutorial. The lever was bundling.
- undetected-chromedriver's name is the search query, and its tagline names
  the vendors it defeats. nodriver inherited that audience by calling itself
  the official successor. A tool named after the failure it fixes gets found.
- rebrowser-patches fixed one documented leak (`Runtime.enable`) and shipped a
  companion detector so users could verify the fix themselves. Third-party
  blogs then cited it as the canonical explanation.
- puppeteer-extra's maintainers run the "Scraping Enthusiasts" Discord. They
  own the room their users need. r/webscraping has 102K members. The other
  Discord is "Scraping In Prod". BlackHatWorld has live threads on browser
  agents and bans, which is the buyer talking about the exact problem.
- Vendor blogs (ZenRows, BrightData, ScrapingBee, ScrapFly) are the biggest
  discovery surface for stealth tools by search volume. They write "how to
  use X" posts about tools that already have traction.
- ripgrep launched on a benchmark blog post (740 HN points) and then became
  VS Code's default search. esbuild's README benchmark table is the unit
  people screenshot. The measurement is the marketing.
- lazygit's Reddit and Facebook posts "fell on deaf ears". An unplanned HN
  thread did it. The author keeps all docs in the README so a reader is one
  click from the star button. No docs site.
- browser-use's Launch HN (259 points): the top comment was a security
  objection about unauthenticated CDP. Skyvern's Launch HN (#1 for hours,
  3,000 stars, 30 newsletters afterwards) had a demo video, a working
  quickstart and a Discord ready before posting. Answer the trust objection
  on the README's first screen, before anyone asks it.
- skills.sh: a top skill took 20,000 installs in six hours from placement
  alone. Stripe shipped a skill within hours of the platform launching.
  Placement beats a cold social post.
- Guillermo Rauch amplifies contributor feature tweets about agent-browser
  with a reply. He does not originate. A shipped, demoable win earns the
  reply; asking does not.
- Drizzle's pitch was a real incident: a client's Prisma system failed at
  100 concurrent users. A public reply to a critic became a YouTube video,
  then Fireship and Web Dev Simplified covered it. agent-hands has its
  incidents already written down in HANDOFF: the agent that navigated the
  user's YouTube tab, the Figma paywall clicked through a backdrop, the
  password typed into a form container. Each is a post.

## 3. The plan: first week, first month, first quarter

Order matters. Nothing in the second block should happen before the first
block is done, because every visit that arrives before the README has a
visual is wasted.

### First week: make the repo worth arriving at

1. **Repo metadata.** Set the description and topics. Commands:

    ```bash
    gh repo edit yassiEmp/agent-hands \
      --description "Human-rate mouse and keyboard for the browser you are logged into. Drives Chrome or Edge over CDP: Bezier paths, Fitts-law timing, lognormal keystrokes. For AI agents on real accounts." \
      --homepage "https://www.npmjs.com/package/agent-hands"
    gh repo edit yassiEmp/agent-hands --add-topic ai-agents --add-topic browser-automation \
      --add-topic chrome-devtools-protocol --add-topic cdp --add-topic claude-code \
      --add-topic agent-browser --add-topic bot-detection --add-topic human-like \
      --add-topic mouse-movement --add-topic windows --add-topic edge --add-topic cli
    ```

2. **The hero visual.** Spec in section 5. Twenty seconds, above the fold,
   ends on a detector page reporting no automation. Without it, skip
   everything below.

3. **skills.sh listing.** The repo already has `skills/agent-hands/SKILL.md`
   in the layout the skills CLI scans. Install it once from a scratch
   directory and check that a listing appears, then add the badge
   agent-browser uses:

    ```bash
    npx skills add yassiEmp/agent-hands
    # then verify https://skills.sh/yassiEmp/agent-hands
    ```

    Badge for the README: `[![skills.sh](https://skills.sh/b/yassiEmp/agent-hands)](https://skills.sh/yassiEmp/agent-hands)`

4. **The evidence page.** `docs/evidence.md`: the event-cadence table from
   the README with the method, the detector screenshots, and the exact
   batch file that reproduces them. State the limits: one detector is not a
   cloak; Turnstile and DataDome still challenge. Honesty is the moat in a
   niche where every tool overclaims.

5. **Measurement baseline.** Run `scripts/metrics.mjs` (section 6) and keep
   the first row.

6. **Issue template** with a "where did you hear about agent-hands" field.

7. **Answer the trust objection on the first screen.** Under the hero: what
   the tool can see, what it cannot (it never reads credentials, never moves
   the physical cursor, never opens a second connection), where the audit log
   is, and what "one detector, not a cloak" means. browser-use's top HN
   comment was this objection. Pre-empt it.

### First month: be seen in the neighbour's rooms

8. **One comment on agent-browser #120.** Data first: the cadence table, the
   detector result, the one-line install, and the sentence "works alongside
   agent-browser; it attaches to the browser you are already logged into".
   No follow-ups unless someone asks.

9. **One comment on PR #1810.** Only if it adds something: the measured
   keystroke and Fitts-law constants under MIT, and the observation that
   a curved path at a uniform sample rate still reads as generated. Offer,
   do not oppose. Skip this step if it would read as hijacking.

10. **Build `agent-browser-plugin-hands`.** `launch.mutate` returns the flags
   `agent-hands launch` already uses (`--disable-blink-features=AutomationControlled`,
   `--force-renderer-accessibility`). `command.run` exposes `click`, `fill`,
   `type`, `press`, `scroll`, `snapshot` by shelling out to agent-hands
   against the session's port file. One to two days of work. Then a docs PR
   to agent-browser's plugins page listing it, in the style of the provider
   pages (#928). This is the "citation follows integration" move and the
   only one on this list that can compound on its own.

11. **awesome lists.** The awesome-claude-code aggregators hold 200K+
    combined stars and rank in search for "claude code X". Target the largest
    (everything-claude-code, 163K stars) plus awesome-agent-skills and
    awesome-browser-automation. Run `awesome-lint`, follow each list's PR
    template exactly, review other open PRs where the template asks.

12. **One issue in OpenClaw** proposing agent-hands as the human-rate input
    lane, in the thread that already asks for a stealth backend (#52190).
    Same shape as the Patchright request: what it fixes, one install line,
    the evidence page. Then the same in Stagehand and Skyvern if a thread
    exists. This is how Patchright reached 200K weekly downloads.

13. **Join the rooms before posting in them.** "Scraping Enthusiasts" and
    "Scraping In Prod" Discords, the MCP community Discord (14K members),
    r/webscraping. Answer ten questions with commands before mentioning the
    tool once.

14. **One Reddit post, problem first.** r/webscraping first, because that is
    where the stealth crowd already is; r/ClaudeAI second, a week later. Title
    shape: "My agent got my Ahrefs account flagged. Here is what the detector
    saw and what fixed it." Link in the first comment.

15. **One demo thread on X.** The hero video, four sentences, the install
    line. Then reply where people complain about agents being banned. Ten
    replies for every self-mention.

### First quarter: compound

16. **Three comparison pages** with a verdict at the top: agent-hands vs
    agent-browser `--human` (after #1810 merges, with the same trace);
    agent-hands vs ghost-cursor; agent-hands vs playwright-stealth. Publish
    on dev.to with `canonical_url` pointing at the repo docs.

17. **One "how it works" post.** Fitts-law, Bezier, lognormal timing, with
    plots from real traces. This is the durable SEO asset.

18. **Show HN**, once: after the visual, the evidence page, and at least two
    outside users or issues. Title: "Show HN: Agent-hands – human-rate mouse
    and keyboard for the browser you're logged into". Monday 00:00 UTC. Do
    not ask anyone to vote.

19. **Newsletters.** Newsletters pick up a spike; they rarely start one.
    Submit the "how it works" post to TLDR AI, Ben's Bites, Latent Space and
    the lists in jackbridger/developer-newsletters the week of the Show HN.

20. **Vendor blogs.** ZenRows, ScrapingBee, ScrapFly and BrightData publish
    "human-like mouse movement" and "avoid bot detection" articles that rank.
    Once the evidence page exists, send each one the page and the install
    line and ask to be included. This is the largest discovery surface for
    ghost-cursor and its peers.

21. **Contributor funnel.** Five good-first-issues with acceptance criteria:
    new words for the `ALLOW` list per locale, macOS and Linux browser paths,
    a docs fix, a `--json` example, a screenshot verb for canvas apps
    (HANDOFF names it as the next gap).

22. **Platform parity before any launch.** The CDP lane is cross-platform
    since 0.17.1; the UIA lane is Windows only by nature. Have one macOS user
    run the quick start before Show HN. A Mac failure on launch day is the
    top comment.

## 4. Channels, ranked for this tool

| Rank | Channel | Why it ranks here | Cost | Expected result |
|---|---|---|---|---|
| 1 | agent-browser issues #120, #1810 | The exact people, already asking | 1 hour | first outside users |
| 2 | agent-browser plugin + docs PR | Citation in a 42k-star project | 2 days | durable referrer |
| 3 | skills.sh listing | Same install path as agent-browser's 854K | 10 min | discoverability |
| 4 | r/webscraping, r/ClaudeAI | Stealth crowd and agent crowd | 2 hours | a spike each |
| 5 | OpenClaw, Stagehand, Skyvern issues | The Patchright path: get requested as infrastructure | 2 hours | durable, if it lands |
| 6 | awesome-claude-code aggregators | 200K+ combined stars, rank in search | 2 hours | steady trickle |
| 7 | Scraping Discords, r/webscraping | Where stealth users already are | ongoing | answers become referrals |
| 8 | Vendor blogs (ZenRows, ScrapingBee, ScrapFly) | Largest search surface for this niche | 2 hours | months 3 to 12 |
| 9 | X demo thread | Cheap, where agent people are | 1 hour | a spike |
| 10 | Comparison pages | 6 to 9% conversion, compounding | 1 day each | months 3 to 12 |
| 11 | Show HN | 2.3% front page, 48-hour bump | half a day | one spike |
| 12 | Newsletters | Pick up a spike, rarely start one | 1 hour | amplification |
| 13 | BlackHatWorld | The buyer, but a reputation risk; answer, never pitch | careful | a few users |
| 14 | Homebrew formula | Passive distribution beside agent-browser | half a day, later | steady trickle |
| 15 | MCP registries | agent-hands is a CLI, not a server; a thin wrapper only after the plugin ships | later | low |
| 16 | Product Hunt | Wrong audience for a free CLI | skip | none |
| 17 | Paid anything | No budget, and it does not work for dev tools | skip | none |

## 5. Artifacts to make, with specs

**Hero GIF, README** (make first)

- 1280x720, 15 to 20 seconds, under 4 MB, `assets/hero.gif` plus an
  `assets/hero.mp4` for X.
- Left half terminal, right half the browser. Terminal runs
  `agent-hands browsers`, `use 1`, `snapshot`, `click --ref @e5`,
  `fill --label Email …`. Browser shows the page reacting.
- Final two seconds: bot-detector.rebrowser.net, green. Caption in the README
  under the GIF: "One detector. Not a cloak. See docs/evidence.md."
- The physical cursor never moves. Say that in the caption; it is the
  surprising part.

**Demo video, X and Reddit**

- 60 to 90 seconds, same footage plus a voice or captions: the problem
  (flagged account), the event trace of a teleporting click, the same
  click through agent-hands, the detector.

**Evidence page** `docs/evidence.md`

- The README cadence table with the method: the page-side listener, the
  batch file, the machine.
- Two screenshots per detector, before and after.
- A limits section: which detectors were not tested, what still challenges.
- A "verify it yourself" block: the exact batch file that opens
  bot-detector.rebrowser.net through agent-hands and reads the verdict. The
  rebrowser pattern: ship the detector with the fix, so nobody has to take
  the claim on faith.

**Comparison pages** `docs/vs-*.md`

- Verdict in the first three lines: "pick X if, pick Y if".
- Three rows that actually differ. For agent-browser: attaches to your own
  browser; typing model; refusals. For ghost-cursor: CLI vs library; typing;
  Windows approval relay.

**The plugin** `agent-browser-plugin-hands`

- Manifest: `{ name: "hands", capabilities: ["launch.mutate", "command.run"] }`.
- `launch.mutate` returns the two clean flags.
- `command.run` maps `hands.click`, `hands.fill`, `hands.type`, `hands.press`,
  `hands.scroll`, `hands.snapshot` to `agent-hands … --cdp <port>` where the
  port comes from the session's `DevToolsActivePort`.
- README of the plugin: three lines and a link back.

**Issue template**

- "What did you run", "what did you expect", "agent-hands doctor output",
  "where did you hear about agent-hands".

## 6. Measurement, weekly

GitHub keeps traffic for 14 days. Snapshot every Monday. `scripts/metrics.mjs`
prints one row; append it to `docs/metrics.csv`.

| Column | Source |
|---|---|
| npm downloads, week | `https://api.npmjs.org/downloads/point/last-week/agent-hands` |
| stars, forks, watchers | `gh api repos/yassiEmp/agent-hands` |
| views, unique visitors, 14 days | `gh api repos/yassiEmp/agent-hands/traffic/views` |
| top referrers | `gh api repos/yassiEmp/agent-hands/traffic/popular/referrers` |
| skills.sh installs | the listing page, by hand |
| issues opened by strangers | `gh issue list --search "-author:yassiEmp"` |
| repos that install it | `gh api search/code -f q='"agent-hands" filename:package.json -user:yassiEmp'` |

What each number means:

- Downloads are the adoption signal. Stars are the awareness signal.
- Referrers tell which channel worked. Nothing else does.
- An issue from a stranger is worth more than fifty stars: someone ran it,
  hit an edge, and cared enough to write.
- The "where did you hear about it" field corrects the referrer data.

## 7. Rules

- Do not claim undetectable. Claim measured. The HANDOFF already says one
  detector is not a cloak. Repeat it everywhere. Overclaiming is how stealth
  tools lose trust, and trust is the only asset here.
- Keep "escalate, do not start here" in the skill. A tool that tells agents
  when not to use it reads as honest, and honesty converts in this niche.
- No bought stars, no vote requests, no cross-posting the same link the same
  day, no launching before the GIF exists.
- One promotional post in ten. The other nine answer questions.
- Say "works alongside agent-browser" in every agent-browser room. Never
  "instead of".
- Every claim in a post has a command or a screenshot behind it.
- Windows first is fine for the code. It is not fine for the launch: test the
  quick start on macOS before Show HN.
- Commit the metrics row weekly. A plan without a number next to it is a
  wish.

## 8. Sources

agent-browser facts, read on 15 Sep 2026:

- Plugin system and capabilities: https://agent-browser.dev/plugins and
  README "Plugin System".
- PR #1810 interpolated mouse movement:
  https://github.com/vercel-labs/agent-browser/pull/1810
- Issue #120 stealth mode: https://github.com/vercel-labs/agent-browser/issues/120
- Provider docs by outside contributors: PRs #928, #1648.
- skills.sh listing for agent-browser: https://skills.sh/vercel-labs/agent-browser
- Skills CLI discovery rules: https://github.com/vercel-labs/skills

Playbook literature (research digest, 15 Sep 2026):

- Show HN numbers, 188k posts analysed:
  https://danfking.github.io/blog/2026/04/23/show-hn-by-the-numbers/
- HN guidelines: https://news.ycombinator.com/newsguidelines.html
- PostHog on developer marketing: https://posthog.com/newsletter/marketing-for-devs
  and https://posthog.com/founders/dev-marketing-for-startups
- Adam DuVander, Developer Marketing Does Not Exist:
  https://everydeveloper.com/developer-marketing/book/
- a16z, open source from community to commercialization:
  https://a16z.com/open-source-from-community-to-commercialization/
- Comparison-page conversion: https://vydera.com/en/lab/comparison-page-seo
- README conversion patterns: https://repoclip.io/blog/how-to-write-a-github-readme
- GitHub description and topics for search:
  https://www.markepear.dev/blog/github-search-engine-optimization
- GitHub Trending mechanics: https://ossinsight.io/blog/introducing-trending-page
- awesome-list PR process:
  https://github.com/sindresorhus/awesome/blob/main/pull_request_template.md
- Reddit self-promotion limits:
  https://jetthoughts.com/blog/self-promote-on-reddit-without-getting-banned-promotion/
- Contributor funnel (Homebrew):
  https://mikemcquaid.com/the-open-source-contributor-funnel-why-people-dont-contribute-to-your-open-source-project/
- Developer newsletters list: https://github.com/jackbridger/developer-newsletters
- Fake stars study: https://arxiv.org/html/2412.13459v2
- Cross-posting with canonical URLs:
  https://brianmorrison.me/blog/how-i-cross-post-to-hashnode-and-devto

Case studies, agent-era tools (research digest, 15 Sep 2026):

- skills.sh 20,000 installs in six hours:
  https://dev.to/stevengonsalvez/skillssh-npm-for-agent-skills-35jc
- Vercel skills ecosystem announcement:
  https://vercel.com/changelog/introducing-skills-the-open-agent-skills-ecosystem
- OpenClaw issue asking for a stealth backend:
  https://github.com/openclaw/openclaw/issues/52190
- browser-use Launch HN: https://news.ycombinator.com/item?id=43173378
- Skyvern Launch HN retrospective:
  https://www.skyvern.com/blog/we-open-sourced-and-ended-up-1-on-hackernews
- Rauch amplifying a contributor's agent-browser feature:
  https://x.com/rauchg/status/2080342124281892956
- awesome-claude-code aggregators:
  https://fast.io/resources/awesome-claude-code-resources-2026/
- Claude Code plugin marketplaces: https://code.claude.com/docs/en/discover-plugins
- Where agent builders congregate:
  https://dev.to/malissia_rowland_7cee31fc/what-reddits-agent-builders-were-actually-debugging-this-week-1hpc
- BlackHatWorld thread on browser agents:
  https://www.blackhatworld.com/seo/free-ai-agent-for-browser-automation.1740197

Case studies, stealth and human-input tools:

- ghost-cursor: https://github.com/Xetera/ghost-cursor and
  https://www.npmjs.com/package/ghost-cursor
- puppeteer-extra-plugin-stealth and the Scraping Enthusiasts Discord:
  https://oxylabs.io/blog/best-web-scraping-discord-server
- undetected-chromedriver: https://github.com/ultrafunkamsterdam/undetected-chromedriver
- nodriver: https://github.com/ultrafunkamsterdam/nodriver
- Camoufox: https://github.com/daijro/camoufox
- rebrowser-patches and the Runtime.enable leak:
  https://rebrowser.net/blog/how-to-fix-runtime-enable-cdp-detection-of-puppeteer-playwright-and-other-automation-libraries
- Patchright, 200K weekly downloads with no launch:
  https://scrapewise.ai/blogs/playwright-stealth-2026
- Subreddits for scraping: https://www.scrapingbee.com/blog/11-best-subreddits-for-webscraping/

Case studies, classic CLIs:

- ripgrep launch post: https://burntsushi.net/ripgrep/ and
  https://news.ycombinator.com/item?id=12564442
- ripgrep in VS Code: https://code.visualstudio.com/updates/v1_11
- fzf missing-demo post:
  https://www.freecodecamp.org/news/fzf-a-command-line-fuzzy-finder-missing-demo-a7de312403ff/
- lazygit five years on: https://jesseduffield.com/Lazygit-5-Years-On/
- esbuild benchmark table: https://github.com/evanw/esbuild
- httpie star loss and regrowth: https://httpie.io/blog/stardust
- shadcn/ui as the default output of AI tools:
  https://redmonk.com/kholterhoff/2025/04/22/ui-component-libraries-shadcn-ui-and-the-revenge-of-copypasta/
- Ollama README ecosystem list: https://github.com/ollama/ollama

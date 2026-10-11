# BUGS

| # | Severity | Beat | What happened | What should happen | How often | Status |
|---|---|---|---|---|---|---|
| 1 | BREAKS DEMO | Steer | Answer never flips past 3 channels on the wolf | Flips at n from steer_review | Every time | FIXED (f29ccf6) |
| 2 | LOOKS WRONG | Adversarial | Camera jumps when switching to adv | Camera stays still | Every time | OPEN, not reproduced: the camera holds exactly still (to 1e-4) on the pair button (v3buttons, cc8demo, on Vultr too), the gallery, and after focus, stability or orbit; rehearse step 5 asserts it every run (3/3 local, 5/6 Vultr; the one miss was before the bot waited for orbit damping to settle). Need Ray's exact steps: which button, and what was on screen just before (focused tip? trunk interior? Steer active?) |
| 3 | SLOW | Stability | First run stutters ~1 s | Smooth from run 1 | First play only | FIXED (aa8f4b4): the start-of-play GPU hitch is gone (2/2 runs before, 0/7 after); mc.json is preloaded. Headed Chrome on the dev Mac still shows an occasional single 66 ms frame on the first play only; to confirm on the 27-inch with ?perf=1 |
| 4 | NIT | HUD | "Steering" badge overlaps QR at 1920 | No overlap | Always | open (web/ui: Codex's lane) |

# BUGS

| # | Severity | Beat | What happened | What should happen | How often | Status |
|---|---|---|---|---|---|---|
| 1 | BREAKS DEMO | Steer | Answer never flips past 3 channels on the wolf | Flips at n from steer_review | Every time | FIXED (f29ccf6) |
| 2 | LOOKS WRONG | Adversarial | Camera jumps when switching to adv | Camera stays still | Every time | FIXED (f29ccf6) |
| 3 | SLOW | Stability | First run stutters ~1 s | Smooth from run 1 | First play only | FIXED (aa8f4b4): the start-of-play GPU hitch is gone (2/2 runs before, 0/7 after); mc.json is preloaded. Headed Chrome on the dev Mac still shows an occasional single 66 ms frame on the first play only; to confirm on the 27-inch with ?perf=1 |
| 4 | NIT | HUD | "Steering" badge overlaps QR at 1920 | No overlap | Always | open (web/ui: Codex's lane) |

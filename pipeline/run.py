"""Stark precompute pipeline.

  python -m pipeline.run [--only <id>] [--force] [--use-backup <id> ...]

Stages may also define run_once(entries, log) for work over all images (skipped with --only).

For each gallery image, runs every applicable stage (pipeline/stages/) whose stamp is out of date, then writes
manifest.json, regenerates the review sheet if anything changed, and validates all outputs (exit 1 on failure).
Runs fully offline from the local caches (~/.keras/models, ~/nltk_data).
"""
import argparse
import sys
import time

from . import config, gallery, jsonio, manifest, review, stamps, validate
from .stages import discover


class Ctx:
    def __init__(self, entry, input_path, out_dir, log):
        self.entry, self.input_path, self.out_dir, self.log = entry, input_path, out_dir, log


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m pipeline.run", description=__doc__.splitlines()[0])
    ap.add_argument("--only", metavar="ID", help="process just this image (others keep their outputs)")
    ap.add_argument("--force", action="store_true", help="ignore stamps and recompute")
    ap.add_argument("--use-backup", metavar="ID", action="append", default=[],
                    help="use the entry's backup photo for this run (repeatable)")
    args = ap.parse_args(argv)

    t0 = time.time()
    entries = gallery.load(use_backup=args.use_backup)
    if args.only and args.only not in {e["id"] for e in entries}:
        ap.error(f"--only: unknown image id {args.only}")
    stages = discover()
    marks = stamps.load()
    changed = False

    for entry in entries:
        if args.only and entry["id"] != args.only:
            continue
        out_dir = config.ASSETS / entry["id"]
        for stage in stages:
            if not stage.applies(entry):
                continue
            tag = f"{entry['id']}:{stage.NAME}"
            # a stage that creates its entry's input (fgsm) stamps against its own source instead
            input_path = stage.input_path(entry) if hasattr(stage, "input_path") else gallery.input_path(entry)
            key = stamps.key(stage, entry, input_path)
            if (not args.force and marks.get(tag) == key
                    and all(p.exists() for p in stage.outputs(entry))):
                print(f"  skip  {tag}")
                continue
            ts = time.time()
            print(f"  run   {tag}  ({input_path.relative_to(config.REPO) if input_path.is_relative_to(config.REPO) else input_path.name})")
            out_dir.mkdir(parents=True, exist_ok=True)
            stage.run(Ctx(entry, input_path, out_dir, lambda m: print(f"        {m}")))
            marks[tag] = key
            stamps.save(marks)
            changed = True
            print(f"        {time.time() - ts:.1f}s")

    # Steps that run once over all images (e.g. the Steer head, reference file and review sheet), after the loop.
    for stage in stages:
        if not hasattr(stage, "run_once") or args.only:
            continue
        tag = f"_once:{stage.NAME}"
        key = stamps.once_key(stage, stage.once_inputs(entries))
        if not args.force and marks.get(tag) == key and all(p.exists() for p in stage.ONCE_OUTPUTS):
            print(f"  skip  {tag}")
            continue
        ts = time.time()
        print(f"  run   {tag}")
        stage.run_once(entries, lambda m: print(f"        {m}"))
        marks[tag] = key
        stamps.save(marks)
        changed = True
        print(f"        {time.time() - ts:.1f}s")

    manifest_changed = manifest.write(entries, warn=lambda m: print(f"  warn  {m}"))
    if changed or manifest_changed or not review.SHEET.exists():
        review.make(jsonio.read(config.ASSETS / "manifest.json")["images"])
        print(f"  wrote {review.SHEET.relative_to(config.REPO)}")

    errs, n = validate.validate_all(entries)
    if errs:
        print(f"validate: {len(errs)} problem(s)")
        for e in errs:
            print("  -", e)
        return 1
    print(f"validate: ok ({n} images)   total {time.time() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())

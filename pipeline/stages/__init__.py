"""Pipeline stages, discovered automatically by pipeline.run.

A stage is a module in this folder that defines:
  NAME            unique string, used in stamps
  ORDER           int; stages run in ascending ORDER for each image (e.g. fgsm < core < atlas)
  SOURCES         pipeline-relative source files whose contents version the stage's output
  applies(entry)  -> bool: does this stage run for this gallery entry?
  outputs(entry)  -> [Path]: files that must exist for a stamp to count as up to date
  run(ctx)        does the work (ctx: entry, input_path, out_dir, log)
  validate(image_dir, entry) -> [str]   optional: error messages for this stage's files
Adding a stage means adding a module here; nothing else needs editing.
"""
import importlib
import pkgutil


def discover():
    mods = []
    for info in pkgutil.iter_modules(__path__):
        mod = importlib.import_module(f"{__name__}.{info.name}")
        if hasattr(mod, "ORDER") and hasattr(mod, "run"):
            mods.append(mod)
    names = [m.NAME for m in mods]
    if len(set(names)) != len(names):
        raise ValueError(f"duplicate stage names: {names}")
    return sorted(mods, key=lambda m: (m.ORDER, m.NAME))

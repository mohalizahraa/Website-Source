"""Make the ``translate`` package importable when tests run from anywhere.

Adds the parent of the package dir (…/pipeline) to sys.path so ``import
translate`` resolves and its relative imports work.
"""

import pathlib
import sys

_PIPELINE_DIR = pathlib.Path(__file__).resolve().parents[2]
if str(_PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(_PIPELINE_DIR))

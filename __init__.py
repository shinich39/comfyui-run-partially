"""
@author: shinich39
@title: comfyui-run-partially
@nickname: comfyui-run-partially
@version: 1.0.1
@description: Run a workflow partially.
"""

from .nodes import *

NODE_CLASS_MAPPINGS = {
  "Breakkk": Breakkk,
}

NODE_DISPLAY_NAME_MAPPINGS = {
  "Breakkk": "Break",
}

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
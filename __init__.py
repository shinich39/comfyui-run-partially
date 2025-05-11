"""
@author: shinich39
@title: comfyui-run-partially
@nickname: comfyui-run-partially
@version: 1.0.0
@description: Run a workflow partially.
"""

from .nodes import *

NODE_CLASS_MAPPINGS = {
  "Skippp": Skippp,
}

NODE_DISPLAY_NAME_MAPPINGS = {
  "Skippp": "Skip",
}

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
# ComfyUI-inspire-pack
class AnyType(str):
    def __ne__(self, __value: object) -> bool:
        return False

ANY_TYPE = AnyType("*")

class Breakkk():
  def __init__(self):
    pass

  @classmethod
  def INPUT_TYPES(cls):
    return {
      "required": {
        "any": ((ANY_TYPE),),
      }
    }
  
  CATEGORY = "utils"
  FUNCTION = "exec"
  RETURN_TYPES = (ANY_TYPE,)
  RETURN_NAMES = ("ANY",)

  def exec(self, any):
    return (any,)
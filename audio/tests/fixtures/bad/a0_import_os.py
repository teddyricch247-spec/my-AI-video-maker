# A0: forbidden import (static check rejects it with a line number)
import os
from synth import *


def render(ctx):
    m = ctx.mix()
    m.add(1.0, soft_pop())
    return m.render()

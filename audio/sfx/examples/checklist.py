# checklist: three items get ticked. Each item is a felt-tip tick mark (two quick pen ticks, folded into one
# group so it counts as one event) followed by a soft pop on the 'pop' marker. 6 events in 10 s is within budget.
from synth import *


def render(ctx):
    m = ctx.mix()
    for i, t in enumerate(ctx.marker_times('pop')):
        # The pen strokes happen just BEFORE the pop that confirms the item.
        strokes = [(t - 0.17, pen_tick(pitch=1900)), (t - 0.09, pen_tick(pitch=2200))]
        m.add_group(f'tick_mark{i + 1}', strokes, gain_db=-9, anchor=f'i{i + 1}')
        m.add(t, soft_pop(pitch=520), gain_db=-4, name=f'done{i + 1}', anchor=f'i{i + 1}')
    return m.render()

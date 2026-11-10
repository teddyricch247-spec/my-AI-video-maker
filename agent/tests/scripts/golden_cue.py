# big_number: the count ticks (one group), then a wood thunk on the landing. Marker 'done' (kind thud) is the landing.
from synth import *


def render(ctx):
    m = ctx.mix()
    done = ctx.marker('done')
    times = tick_times(done - 0.8, done - 0.2, 5, 'ease_in')
    m.add_group('count_ticks', [(t, pen_tick(pitch=1600 + 90 * i)) for i, t in enumerate(times)], gain_db=-9)
    m.add(done, wood_thunk(pitch=125), gain_db=0, name='thunk', anchor='done', align='peak')
    return m.render()

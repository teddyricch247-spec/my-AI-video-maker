# flow_pops: a node diagram. Each 'pop' marker is a node appearing; each 'whoosh' marker is an arrow
# travelling to the next node. 5 events in an 8 s beat is right at the budget (about 5).
from synth import *


def render(ctx):
    m = ctx.mix()
    pops = ctx.marker_times('pop')
    # One soft pop per node; pitch climbs a little so the sequence feels like it is building.
    for i, t in enumerate(pops):
        m.add(t, soft_pop(pitch=400 + 60 * i), gain_db=-4, name=f'node{i + 1}', anchor=f'n{i + 1}')
    # Swooshes are soft details (-9 dB). align='peak' makes the loudest part land on the arrow marker.
    for i, t in enumerate(ctx.marker_times('whoosh')):
        m.add(t, swoosh(dur=0.4, direction='up', bright=0.4), gain_db=-9, name=f'arrow{i + 1}',
              anchor=f'a{i + 1}', align='peak')
    return m.render()

"""Stress test: renders ~50 NON-default param variants (long/short lists, every chart type and app mode, 1-12 nodes, empty arrays...) at t=0..15 and
reports exceptions, console errors and text outside bounds / under 14 px.  python tools/stress.py   (wrote /tmp/var.png contact montage -> qa-stress.png)"""
import sys,json,base64,io,os
sys.path.insert(0,os.path.dirname(__file__))
from _common import *
import importlib.util
spec=importlib.util.spec_from_file_location('chk',os.path.join(os.path.dirname(__file__),'check.py')); chk=importlib.util.module_from_spec(spec); spec.loader.exec_module(chk)
from PIL import Image
from playwright.sync_api import sync_playwright
V=[('tech/chart-draw',{'type':'donut','data':[62,25,13],'labels':['Mobile','Desktop','Other'],'unit':'%'}),
('tech/chart-draw',{'type':'line'}),('tech/chart-draw',{'type':'bar','data':[5,9],'labels':['A','B']}),
('tech/chart-draw',{'type':'donut','data':[1,1,1,1,1,1,1,1],'labels':list('ABCDEFGH')}),
('tech/app-window',{'mode':'bars'}),('tech/app-window',{'mode':'list','items':['a','b'],'tags':['PAID','DUE'],'target':1}),('tech/app-window',{'mode':'form','fields':['Name'],'inputs':['Ada']}),
('tech/flow-diagram',{'nodes':['A','B','C'],'notes':[]}),('tech/flow-diagram',{'nodes':list('ABCDE')}),('tech/flow-diagram',{'nodes':list('ABCDEF')}),('tech/flow-diagram',{'nodes':['Solo']}),
('tech/checklist-reveal',{'items':list('1234567')}),('tech/checklist-reveal',{'items':['One']}),
('tech/timeline-roadmap',{'items':['A|x','B|y','C|z'],'current':2}),('tech/timeline-roadmap',{'items':['1|a','2|b','3|c','4|d','5|e','6|f'],'current':5}),
('tech/kanban-board',{'cols':['A|x','B|','C|']}),('tech/funnel',{'stages':['a|10','b|5','c|1']}),('tech/funnel',{'stages':['a|10','b|5','c|1','d|1','e|1']}),
('tech/code-window',{'lines':['x=1'],'highlight':-1,'error':-1}),('tech/code-window',{'lines':['a']*9,'error':8}),('tech/title-card',{'lines':['One long headline line that goes on']}),
('tech/title-card',{'lines':['A','B','C'],'accent':-1}),('tech/quote-card',{'quote':'Short.','mark':''}),('tech/quote-card',{'quote':'x '*70,'mark':'zzz'}),
('tech/matrix-2x2',{'items':[],'highlight':-1}),('tech/phone-mock',{'detail':[]}),('tech/dashboard',{'kpis':['A|1|+1%','B|2|-1%','C|3|+0','D|4|+9'],'title':'T'}),
('tech/big-stat',{'value':1234567,'prefix':'$','suffix':'','decimals':0}),('tech/big-stat',{'value':0}),('tech/isotype-crowd',{'left':0}),('tech/isotype-crowd',{'left':100}),
('tech/network-graph',{'labels':['H']}),('tech/network-graph',{'labels':list('ABCDEFGHIJKL')}),('tech/calendar-gantt',{'tasks':[],'weeks':12}),('tech/calendar-gantt',{'tasks':['a|10|9'],'weeks':8}),
('tech/compare-split',{'leftItems':[],'rightItems':['a']*5,'leftValue':'1234567890 long value'}),('tech/terminal-log',{'lines':[]}),('tech/progress-loader',{'pct':40,'loaded':[]}),
('tech/proof-card',{'ring':[],'badge':''}),('tech/section-divider',{'number':'Chapter Seven'}),('obj/chart-bars',{'values':[1,2,3]}),('obj/gear',{'teeth':12}),('obj/gear',{'teeth':3}),('obj/coin-stack',{'count':99}),('obj/battery',{'level':-5}),
('fx/stamp',{'text':'X','size':14}),('fx/speech-bubble',{'text':'A very long line of dialogue that keeps going and going'}),('fx/thought-bubble',{'text':''}),('fx/confetti',{'count':0}),('fx/bracket',{'dir':'h','label':'Total'}),('fx/speed-lines',{'lines':0})]
bad=0; shots=[]
with serve() as base, sync_playwright() as p:
    b=p.chromium.launch(); e=[]; pg=open_harness(b,base,e); metas=pg.evaluate('window.metas()')
    for id_,prm in V:
        e.clear(); iss=[]
        try:
            for t in (0,.5,1.5,3,8,15):
                pg.evaluate("([id,t,p])=>{window.textLog=[];window.logText=true;try{window.pixels(id,t,p)}finally{window.logText=false}}",[id_,t,prm])
                if t in (8,15): iss+=chk.text_issues(pg.evaluate('window.textLog'),metas[id_]['kind'],t)
            pg.evaluate("([id,p])=>window.markers(id,p)",[id_,prm])
        except Exception as ex: iss.append('EXC '+str(ex).split('\n')[0][:150])
        if e: iss.append(str(e[0])[:100])
        if iss: bad+=1; print('ISSUE',id_,json.dumps(prm)[:70],sorted(set(iss))[:3])
        if id_ in('tech/chart-draw','tech/app-window') and iss==[]:
            pg.evaluate("([id,p])=>window.drawAsset(id,8,p)",[id_,prm]); shots.append(Image.open(io.BytesIO(base64.b64decode(pg.evaluate('window.png()').split(',')[1]))).resize((640,360)))
print('variants',len(V),'with issues',bad)
M=Image.new('RGB',(1280,360*((len(shots)+1)//2)))
for i,im in enumerate(shots): M.paste(im,((i%2)*640,(i//2)*360))
M.save(os.path.join(ROOT,'qa-stress.png'))

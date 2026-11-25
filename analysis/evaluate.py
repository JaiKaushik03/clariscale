"""Read private Qualtrics CSV, emit aggregates only. Python 3.12+, standard library."""
import argparse,csv,json,math,statistics,hashlib
from pathlib import Path

def number(v):
 try:
  x=float(v)
  return x if math.isfinite(x) else None
 except (ValueError,TypeError):return None

def sus(vals):
 if len(vals)!=10 or any(x is None or x!=int(x) or not 1<=x<=5 for x in vals):return None
 return sum(x-1 if i%2==0 else 5-x for i,x in enumerate(vals))*2.5

def cdf(x,df):
 if x<0:return 1-cdf(-x,df)
 if x==0:return .5
 # Composite Simpson integration of Student's t density. No statistical package needed.
 n=4000;h=x/n;c=math.exp(math.lgamma((df+1)/2)-math.lgamma(df/2))/math.sqrt(df*math.pi)
 f=lambda t:c*(1+t*t/df)**(-(df+1)/2)
 return min(1,.5+h/3*(f(0)+f(x)+sum((4 if i%2 else 2)*f(i*h) for i in range(1,n))))

def paired(pairs):
 if len(pairs)<2:return {'n':len(pairs),'difference':None,'ci95':None,'p_exploratory':None}
 d=[b-a for a,b in pairs];m=statistics.mean(d);se=statistics.stdev(d)/math.sqrt(len(d));lo,hi=0,20
 for _ in range(45):
  mid=(lo+hi)/2
  if cdf(mid,len(d)-1)<.975:lo=mid
  else:hi=mid
 half=(lo+hi)/2*se
 return {'n':len(d),'A_mean':statistics.mean(a for a,b in pairs),'B_mean':statistics.mean(b for a,b in pairs),'difference':m,'ci95':[m-half,m+half],'p_exploratory':2*(1-cdf(abs(m/se),len(d)-1)) if se else (1 if m==0 else 0),'B_greater_count':sum(x>0 for x in d)}

def analyze(p):
 rows=[r for r in csv.DictReader(p.open(encoding='utf-8-sig')) if r.get('Consent')=='1' and r.get('__js_DataType')=='study']
 sus_pairs=[];time_pairs=[];all_times=[];pss_complete=0
 for r in rows:
  scores=[sus([number(r.get(f'SUS_{c}_{i:02}')) for i in range(1,11)]) for c in 'AB']
  if all(x is not None for x in scores):sus_pairs.append(scores)
  times=[]
  for c,ids in [('A',range(1,6)),('B',range(6,11))]:
   vals=[number(r.get(f'__js_{c}_Q{i:02}_Seconds')) for i in ids]
   times.append(sum(vals) if all(x is not None and x>=0 for x in vals) else None)
  texts=all(bool(r.get(f'__js_B_Q{i:02}_Original','').strip()) for i in range(6,11))
  if all(x is not None for x in times):
   all_times.append(times)
   if texts:time_pairs.append(times)
  cats=[number(r.get(f'__js_A_Q{i:02}_Category')) for i in range(1,6)]
  for i in range(6,11):
   a=number(r.get(f'__js_B_Q{i:02}_AutoCat'));b=number(r.get(f'__js_B_Q{i:02}_FallbackCat'));cats.append(a if a is not None else b)
  pss_complete+=all(v is not None and v==int(v) and 0<=v<=4 for v in cats)
 return {'source_sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'consented_records':len(rows),'assigned_orders':{c:sum(r.get('Order')==c for r in rows) for c in ['AB','BA']},'complete_pss_records':pss_complete,'SUS':paired(sus_pairs),'primary_item_time_seconds':paired(time_pairs),'all_ten_time_sensitivity':paired(all_times),'caveats':['The n=9 subsets differ.','Different item content confounds response format.','Assigned order is not verified historical actual order.','Intervals and p-values are exploratory paired t estimates.']}
if __name__=='__main__':
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--input',required=True,type=Path);args=ap.parse_args();print(json.dumps(analyze(args.input),indent=2))

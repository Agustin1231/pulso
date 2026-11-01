# Modelo de 7 variables entrenado con 18+ (el del documento), evaluado en 40-69 y con umbral elegido en entrenamiento
import pandas as pd, numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.model_selection import RepeatedStratifiedKFold
from sklearn.metrics import roc_auc_score, roc_curve, brier_score_loss
from scipy.optimize import minimize_scalar
d=pd.read_csv('data/nhanes-2021-2023/muestra-analitica.csv')
F7=['fc','imc','sueno','phq9','fumador','edad','hombre']; X=d[F7].values; y=d.evento.values
m4069=((d.edad>=40)&(d.edad<=69)).values
def modelo(): return make_pipeline(StandardScaler(),LogisticRegression(C=100,max_iter=2000))
def met(pr,yt):
    tp=(pr&(yt==1)).sum(); fp=(pr&(yt==0)).sum(); fn=(~pr&(yt==1)).sum(); tn=(~pr&(yt==0)).sum()
    return dict(sens=tp/(tp+fn),esp=tn/(tn+fp),vpp=tp/max(tp+fp,1),vpn=tn/max(tn+fn,1),pos=pr.mean())
R=[];S=[];aucs_t=[];aucs_s=[];oof=np.zeros(len(d))
rskf=RepeatedStratifiedKFold(n_splits=5,n_repeats=10,random_state=42)
for k,(tr,te) in enumerate(rskf.split(X,y)):
    m=modelo().fit(X[tr],y[tr]); ptr=m.predict_proba(X[tr])[:,1]; pte=m.predict_proba(X[te])[:,1]
    fpr,tpr,th=roc_curve(y[tr],ptr); u=th[np.argmax(tpr-fpr)]
    R.append(dict(umbral=u,**met(pte>=u,y[te])))
    sub=m4069[te]; S.append(met(pte[sub]>=u,y[te][sub])); aucs_s.append(roc_auc_score(y[te][sub],pte[sub])); aucs_t.append(roc_auc_score(y[te],pte))
    if k<5: oof[te]=pte
R=pd.DataFrame(R);S=pd.DataFrame(S)
f=lambda s:f"{s.mean():.3f} ± {s.std():.3f}"
print("AUC por partición: todos",f(pd.Series(aucs_t)),"| 40-69",f(pd.Series(aucs_s)))
print("Umbral elegido en entrenamiento:",f(R.umbral))
print("Todos:",{c:f(R[c]) for c in ['sens','esp','vpp','vpn','pos']})
print("40-69:",{c:f(S[c]) for c in ['sens','esp','vpp','vpn','pos']})
def calib(p,yy):
    off=np.log(p/(1-p)); s=LogisticRegression(C=1e6,max_iter=2000).fit(off.reshape(-1,1),yy).coef_[0][0]
    a=minimize_scalar(lambda a: np.sum(np.log1p(np.exp(a+off))-yy*(a+off))).x; return s,a
for nombre,mm in [("todos",np.ones(len(d),bool)),("40-69",m4069)]:
    s,a=calib(oof[mm],y[mm]); print(f"Calibración {nombre}: pendiente {s:.2f} intercepto {a:+.2f} Brier {brier_score_loss(y[mm],oof[mm]):.4f} pred {oof[mm].mean()*100:.1f}% obs {y[mm].mean()*100:.1f}%")
cats=pd.cut(oof[m4069],[0,0.05,0.10,0.20,1],labels=['<5%','5-10%','10-20%','>=20%'])
t=pd.DataFrame({'cat':cats,'y':y[m4069],'p':oof[m4069]}).groupby('cat',observed=True).agg(n=('y','size'),pred=('p','mean'),obs=('y','mean'))
print("Categorías 40-69:");print((t.assign(pred=t.pred*100,obs=t.obs*100)).round(1).to_string())
D='data/nhanes-2021-2023/xpt/'
demo=pd.read_sas(D+'DEMO_L.xpt')[['SEQN','WTMEC2YR','RIDAGEYR','RIAGENDR']].rename(columns={'SEQN':'seqn'})
w=d.merge(demo,on='seqn',how='left').WTMEC2YR.values
for nombre,mm in [("todos",np.ones(len(d),bool)),("40-69",m4069)]:
    ok=mm&(w>0)
    print(f"Pesos {nombre}: AUC {roc_auc_score(y[ok],oof[ok],sample_weight=w[ok]):.3f} prev pond {np.average(y[ok],weights=w[ok])*100:.1f}% pred pond {np.average(oof[ok],weights=w[ok])*100:.1f}%")
ad=demo[(demo.RIDAGEYR>=18)&(demo.WTMEC2YR>0)]; inc=ad.seqn.isin(d.seqn)
print(f"Casos completos 18+: {inc.sum()} de {len(ad)} examinados ({(1-inc.mean())*100:.1f}% excluidos); edad {ad[inc].RIDAGEYR.mean():.1f} vs {ad[~inc].RIDAGEYR.mean():.1f}; hombres {(ad[inc].RIAGENDR==1).mean()*100:.1f}% vs {(ad[~inc].RIAGENDR==1).mean()*100:.1f}%")
mcq=pd.read_sas(D+'MCQ_L.xpt'); cols=['MCQ160B','MCQ160C','MCQ160D','MCQ160E','MCQ160F']
ev=mcq[['SEQN']+cols].copy(); ev['ev']=(ev[cols]==1).any(axis=1); ev['con']=ev[cols].isin([1,2]).all(axis=1)
a2=ad.merge(ev.rename(columns={'SEQN':'seqn'}),on='seqn',how='left'); ex=a2[~a2.seqn.isin(d.seqn)&(a2.con==True)]
print(f"Antecedente CV excluidos con desenlace conocido {ex.ev.mean()*100:.1f}% (n={len(ex)}) vs incluidos {y.mean()*100:.1f}%; edad excluidos con desenlace {ex.RIDAGEYR.mean():.1f}")

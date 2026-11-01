import pandas as pd, numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.model_selection import RepeatedStratifiedKFold
from sklearn.metrics import roc_auc_score, roc_curve
d=pd.read_csv('data/nhanes-2021-2023/muestra-analitica.csv')
F7=['fc','imc','sueno','phq9','fumador','edad','hombre']
s=d[(d.edad>=40)&(d.edad<=69)].reset_index(drop=True); X=s[F7].values; y=s.evento.values
def modelo(): return make_pipeline(StandardScaler(),LogisticRegression(C=100,max_iter=2000))
# 1) Umbral elegido DENTRO del entrenamiento (Youden sobre predicciones de entrenamiento), aplicado a la prueba
rs=[]; oof=np.zeros(len(s))
rskf=RepeatedStratifiedKFold(n_splits=5,n_repeats=10,random_state=42)
for k,(tr,te) in enumerate(rskf.split(X,y)):
    m=modelo().fit(X[tr],y[tr]); ptr=m.predict_proba(X[tr])[:,1]; pte=m.predict_proba(X[te])[:,1]
    fpr,tpr,th=roc_curve(y[tr],ptr); u=th[np.argmax(tpr-fpr)]
    pr=pte>=u; yt=y[te]
    tp=(pr&(yt==1)).sum(); fp=(pr&(yt==0)).sum(); fn=(~pr&(yt==1)).sum(); tn=(~pr&(yt==0)).sum()
    rs.append(dict(umbral=u,sens=tp/(tp+fn),esp=tn/(tn+fp),vpp=tp/max(tp+fp,1),vpn=tn/max(tn+fn,1),pos=pr.mean()))
    if k<5: oof[te]=pte
r=pd.DataFrame(rs)
print("== 40-69, umbral de Youden elegido en el entrenamiento y medido en la prueba (50 particiones)")
for c in r.columns: print(f"  {c:7s} {r[c].mean():.3f} ± {r[c].std():.3f}")
# 2) Mismo esquema pero con umbral elegido sobre las mismas predicciones (optimista) para comparar
fpr,tpr,th=roc_curve(y,oof); u=th[np.argmax(tpr-fpr)]; pr=oof>=u
tp=(pr&(y==1)).sum(); fp=(pr&(y==0)).sum(); fn=(~pr&(y==1)).sum(); tn=(~pr&(y==0)).sum()
print(f"== Comparación optimista (umbral elegido sobre las mismas predicciones): umbral {u:.3f} sens {tp/(tp+fn):.3f} esp {tn/(tn+fp):.3f} VPP {tp/(tp+fp):.3f} VPN {tn/(tn+fn):.3f}")
# 3) VPP por categoría de riesgo (fuera de muestra, repetición 1)
cats=pd.cut(oof,[0,0.05,0.10,0.20,1],labels=['<5%','5-10%','10-20%','>=20%'])
t=pd.DataFrame({'cat':cats,'y':y}).groupby('cat',observed=True).agg(n=('y','size'),casos=('y','sum'),obs=('y','mean'))
print("== Categorías de riesgo (40-69, fuera de muestra)"); print(t.assign(obs=lambda x:(x.obs*100).round(1)).to_string())
# 4) Pesos muestrales y casos completos
D='data/nhanes-2021-2023/xpt/'
demo=pd.read_sas(D+'DEMO_L.xpt'); w=demo[['SEQN','WTMEC2YR','RIDAGEYR','RIAGENDR']].rename(columns={'SEQN':'seqn'})
sw=s.merge(w,on='seqn',how='left'); ww=sw.WTMEC2YR.values
print(f"== Pesos: {np.isnan(ww).sum()} sin peso de {len(ww)}")
ok=~np.isnan(ww)&(ww>0)
print(f"  AUC 40-69 sin pesos {roc_auc_score(y,oof):.3f} | con WTMEC2YR {roc_auc_score(y[ok],oof[ok],sample_weight=ww[ok]):.3f}")
print(f"  prevalencia sin pesos {y.mean()*100:.1f}% | ponderada {np.average(y[ok],weights=ww[ok])*100:.1f}% | riesgo predicho ponderado {np.average(oof[ok],weights=ww[ok])*100:.1f}%")
# casos completos: adultos 40-69 elegibles en DEMO con examen
adultos=w[(w.RIDAGEYR>=40)&(w.RIDAGEYR<=69)&(w.WTMEC2YR>0)]
inc=adultos.seqn.isin(s.seqn)
print(f"== Casos completos 40-69: {inc.sum()} incluidos de {len(adultos)} examinados ({(1-inc.mean())*100:.1f}% excluidos)")
print(f"  edad media incluidos {adultos[inc].RIDAGEYR.mean():.1f} vs excluidos {adultos[~inc].RIDAGEYR.mean():.1f} | % hombres {(adultos[inc].RIAGENDR==1).mean()*100:.1f} vs {(adultos[~inc].RIAGENDR==1).mean()*100:.1f}")
mcq=pd.read_sas(D+'MCQ_L.xpt'); cols=[c for c in ['MCQ160B','MCQ160C','MCQ160D','MCQ160E','MCQ160F'] if c in mcq]
ev=mcq[['SEQN']+cols].copy(); ev['ev']=(ev[cols]==1).any(axis=1); ev['conocido']=ev[cols].isin([1,2]).all(axis=1)
a2=adultos.merge(ev.rename(columns={'SEQN':'seqn'}),on='seqn',how='left')
ex=a2[~a2.seqn.isin(s.seqn)&a2.conocido.fillna(False)]
print(f"  antecedente CV en excluidos con desenlace conocido: {ex.ev.mean()*100:.1f}% (n={len(ex)}) vs incluidos {y.mean()*100:.1f}%")

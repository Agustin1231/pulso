import pandas as pd, numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.model_selection import RepeatedStratifiedKFold
from sklearn.metrics import roc_auc_score, brier_score_loss
d=pd.read_csv('data/nhanes-2021-2023/muestra-analitica.csv')
F7=['fc','imc','sueno','phq9','fumador','edad','hombre']; F2=['edad','hombre']; F5=['fc','imc','sueno','phq9','fumador']
y=d.evento.values
def oof(df,feats,seed=42):
    X=df[feats].values; yy=df.evento.values; P=np.zeros((10,len(df)))
    rskf=RepeatedStratifiedKFold(n_splits=5,n_repeats=10,random_state=seed)
    for k,(tr,te) in enumerate(rskf.split(X,yy)):
        m=make_pipeline(StandardScaler(),LogisticRegression(C=100,max_iter=2000)).fit(X[tr],yy[tr])
        P[k//5,te]=m.predict_proba(X[te])[:,1]
    return P
def calib(p,yy):
    lp=np.log(p/(1-p)).reshape(-1,1)
    s=LogisticRegression(C=1e6,max_iter=2000).fit(lp,yy).coef_[0][0]
    from scipy.optimize import minimize_scalar
    off=np.log(p/(1-p))
    def nll(a): z=a+off; return np.sum(np.log1p(np.exp(z))-yy*z)
    a=minimize_scalar(nll).x
    return s,a
def resumen(P,yy,mask,nombre):
    aucs=[roc_auc_score(yy[mask],P[r,mask]) for r in range(10)]
    p=P[0,mask]; s,a=calib(p,yy[mask])
    print(f"{nombre:58s} n={mask.sum():5d} casos={yy[mask].sum():4d} ({yy[mask].mean()*100:4.1f}%)  AUC {np.mean(aucs):.3f} ± {np.std(aucs):.3f}  Brier {brier_score_loss(yy[mask],p):.4f}  pendiente {s:.2f}  intercepto {a:+.2f}  pred {p.mean()*100:4.1f}% obs {yy[mask].mean()*100:4.1f}%")
P7=oof(d,F7); P2=oof(d,F2); P5=oof(d,F5)
todos=np.ones(len(d),bool); m4069=(d.edad>=40)&(d.edad<=69)
print("== Modelo entrenado con todos los adultos (18+), evaluado por subgrupo (predicciones fuera de muestra)")
resumen(P7,y,todos,"7 variables, todos")
resumen(P7,y,m4069.values,"7 variables, solo 40-69")
resumen(P2,y,m4069.values,"solo edad y sexo, solo 40-69")
resumen(P5,y,m4069.values,"solo estilo de vida, solo 40-69")
for lo,hi in [(18,39),(40,49),(50,59),(60,69),(70,80)]:
    mm=((d.edad>=lo)&(d.edad<=hi)).values
    resumen(P7,y,mm,f"7 variables, {lo}-{hi}")
print("== Modelo entrenado y evaluado solo con 40-69")
s=d[m4069].reset_index(drop=True); ys=s.evento.values; ms=np.ones(len(s),bool)
Q7=oof(s,F7); Q2=oof(s,F2); Q5=oof(s,F5)
resumen(Q7,ys,ms,"7 variables")
resumen(Q2,ys,ms,"solo edad y sexo")
resumen(Q5,ys,ms,"solo estilo de vida")
# delta bootstrap 40-69 (7 vs edad+sexo), repeticion 1
rng=np.random.default_rng(42); dl=[]
for _ in range(2000):
    i=rng.integers(0,len(s),len(s))
    if ys[i].min()==ys[i].max(): continue
    dl.append(roc_auc_score(ys[i],Q7[0,i])-roc_auc_score(ys[i],Q2[0,i]))
print(f"ΔAUC 7 vars vs edad+sexo en 40-69 (entrenado en 40-69): {np.mean(dl):+.3f} IC95 [{np.percentile(dl,2.5):+.3f}, {np.percentile(dl,97.5):+.3f}]")
# deciles 40-69 entrenado 40-69
p=Q7[0]; q=pd.qcut(p,10,labels=False)
print("Deciles (40-69, modelo 40-69): " + " | ".join(f"{p[q==k].mean()*100:.1f}/{ys[q==k].mean()*100:.1f}" for k in range(10)))

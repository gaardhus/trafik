import polars as pl, json, sys
rows=[json.loads(l) for l in open(sys.argv[1])]
df=pl.DataFrame([{
 'id':r['_id'],'region':r['region'],'type':r['incidentType'],'text':r['text'],
 'created':r['createdTime'],'sort':r['sortTime'],'n_upd':len(r['updates']),
 'n_loc':len(r['location']),'link':r.get('link',''),'highlight':r['highlight'],'deleted':r['deleted'],
} for r in rows]).with_columns(pl.col('created','sort').str.to_datetime(time_zone='UTC').dt.convert_time_zone('Europe/Copenhagen'))
df=df.with_columns(dur_h=(pl.col('sort')-pl.col('created')).dt.total_minutes()/60)
pl.Config.set_tbl_rows(40); pl.Config.set_fmt_str_lengths(90)
print(df['type'].value_counts(sort=True)); print(df['region'].value_counts(sort=True))
print(df.group_by('type').agg(pl.len(),pl.col('dur_h').median().round(2),pl.col('dur_h').quantile(.9).round(1).alias('p90_h'),pl.col('n_upd').mean().round(2)).sort('len',descending=True))
print(df['n_loc'].value_counts(sort=True)); print(df['highlight'].sum(), df['deleted'].sum())
print(df.with_columns(pl.col('link').str.extract(r'https?://([^/]+)')).group_by('link').len().sort('len',descending=True).head(12))
print(df.sample(25,seed=1).select('type','region','text'))

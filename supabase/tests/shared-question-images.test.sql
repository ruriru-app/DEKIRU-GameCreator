begin;
\ir helpers/setup.inc
create function pg_temp.pooled_project() returns jsonb language sql as $$
 select jsonb_set(pg_temp.project(),'{questions,0,image}','{"imageId":"img1","placement":"top","alt":"図"}')||jsonb_build_object('schemaVersion',3,'images',jsonb_build_array(jsonb_build_object('id','img1','dataUrl','data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAANSURBVBhXY0gJ0GgAAANVAV3Gr6LbAAAAAElFTkSuQmCC','width',1,'height',1)));
$$;
select is(private.validate_project(pg_temp.pooled_project()::text,'publish')->>'ok','true','v3 compact project accepted');
select is(public.creator_context()->'data'->'capabilities'->>'sharedImages','false','new writes default off');
select is(public.mutate_game('save',pg_temp.args(null,0,pg_temp.pooled_project()))->'error'->>'code','SERVICE_UNAVAILABLE','v3 save gated');
select is(private.validate_project(jsonb_set(pg_temp.pooled_project(),'{questions,0,image,imageId}','"img2"')::text,'draft')->'error'->>'code','VALIDATION','missing reference rejected');
select is(private.validate_project(jsonb_set(pg_temp.pooled_project(),'{images,0,width}','2')::text,'draft')->'error'->>'code','VALIDATION','actual dimensions retained');
select * from finish();
rollback;

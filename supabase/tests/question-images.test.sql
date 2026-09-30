begin;
\ir helpers/setup.inc
create function pg_temp.picture() returns jsonb language sql as $$
 select jsonb_build_object('dataUrl','data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAANSURBVBhXY0gJ0GgAAANVAV3Gr6LbAAAAAElFTkSuQmCC','width',1,'height',1,'placement','top','alt','図');
$$;
create function pg_temp.image_project() returns jsonb language sql as $$
 select jsonb_set(jsonb_set(pg_temp.project(),'{schemaVersion}','2'),'{questions,0,image}',pg_temp.picture());
$$;
select is(private.validate_project(pg_temp.image_project()::text,'publish')->>'ok','true','v2 accepts bounded PNG');
select is(private.validate_project(jsonb_set(pg_temp.image_project(),'{questions,0,image,dataUrl}',to_jsonb('data:image/jpeg;base64,/9j/wAAICAABAAEA/9oABgAAPwD/2Q=='::text))::text,'publish')->'error'->>'code','VALIDATION','zero-component JPEG cannot be published');
select is(private.validate_project(jsonb_set(pg_temp.image_project(),'{schemaVersion}','1')::text,'draft')->'error'->>'code','VALIDATION','v1 image rejected');
select is(private.validate_project(jsonb_set(pg_temp.image_project(),'{questions,0,image,width}','2')::text,'draft')->'error'->>'code','VALIDATION','actual dimensions checked');
select is(private.validate_project(jsonb_set(pg_temp.image_project(),'{questions,0,image,filename}','"private.jpg"')::text,'draft')->'error'->>'code','VALIDATION','image extra keys rejected');
select is(private.validate_project(jsonb_set(pg_temp.image_project(),'{questions,0,image,dataUrl}',to_jsonb(replace(pg_temp.picture()->>'dataUrl','image/png','image/jpeg')))::text,'draft')->'error'->>'code','VALIDATION','MIME must match bytes');
select is(private.validate_project(jsonb_set(pg_temp.image_project(),'{questions,0,image,alt}',to_jsonb(repeat('😀',101)))::text,'draft')->'error'->>'code','VALIDATION','alt uses UTF16 length like browser');
select is(public.creator_context()->'data'->'capabilities'->>'questionImages','false','image writes initially disabled');
select is(public.mutate_game('save',pg_temp.args(null,0,pg_temp.image_project()))->'error'->>'code','SERVICE_UNAVAILABLE','v2 writes gated');
create temp table older as select public.mutate_game('save',pg_temp.args())->'data' meta;
update older set meta=public.mutate_game('publish',pg_temp.command((meta->>'id')::uuid,(meta->>'version')::int))->'data';
create temp table old_share as select meta->'publication'->>'shareId' id from older;
select is(public.read_shared_game((select id from old_share))->>'runtimeVersion','fusuma-1','v1 remains available');
update private.service_control set question_images_enabled=true where id;
create temp table illustrated as select public.mutate_game('save',pg_temp.args(null,0,pg_temp.image_project()))->'data' meta;
update illustrated set meta=public.mutate_game('publish',pg_temp.command((meta->>'id')::uuid,(meta->>'version')::int))->'data';
select is((select meta->'publication'->>'runtimeVersion' from illustrated),'fusuma-2','v2 chooses fixed runtime');
create temp table image_share as select meta->'publication'->>'shareId' id from illustrated;
select is(public.read_shared_game((select id from image_share))->'project'->'questions'->0->'image',pg_temp.picture(),'snapshot includes image');
update private.service_control set question_images_enabled=false where id;
select is(public.load_game((select (meta->>'id')::uuid from illustrated))->>'ok','true','v2 load remains available when write gate closed');
select is(public.mutate_game('publish',pg_temp.command((select (meta->>'id')::uuid from illustrated),(select (meta->>'version')::int from illustrated)))->'error'->>'code','SERVICE_UNAVAILABLE','v2 publish closed');
update illustrated set meta=public.mutate_game('unpublish',pg_temp.command((meta->>'id')::uuid,(meta->>'version')::int))->'data';
select is(public.mutate_game('republish',pg_temp.command((select (meta->>'id')::uuid from illustrated),(select (meta->>'version')::int from illustrated)))->'error'->>'code','SERVICE_UNAVAILABLE','v2 republish closed');
update private.service_control set question_images_enabled=true where id;
-- Published v2 snapshot is retained even when draft becomes v1.
update illustrated set meta=public.mutate_game('save',pg_temp.args((meta->>'id')::uuid,(meta->>'version')::int,pg_temp.project()))->'data';
update private.service_control set question_images_enabled=false where id;
select is(public.mutate_game('republish',pg_temp.command((select (meta->>'id')::uuid from illustrated),(select (meta->>'version')::int from illustrated)))->'error'->>'code','SERVICE_UNAVAILABLE','republish gate checks snapshot, not draft');
update private.service_control set question_images_enabled=true where id;
update illustrated set meta=public.mutate_game('republish',pg_temp.command((meta->>'id')::uuid,(meta->>'version')::int))->'data';
select is(public.read_shared_game((select id from image_share))->'project'->'questions'->0->'image',pg_temp.picture(),'republish retains old snapshot and URL');
-- Reverse case: draft v2 must not prevent re-enabling its old v1 publication.
update older set meta=public.mutate_game('save',pg_temp.args((meta->>'id')::uuid,(meta->>'version')::int,pg_temp.image_project()))->'data';
update older set meta=public.mutate_game('unpublish',pg_temp.command((meta->>'id')::uuid,(meta->>'version')::int))->'data';
update private.accounts set minute_count=0,day_count=0;
update private.service_control set question_images_enabled=false where id;
update older set meta=public.mutate_game('republish',pg_temp.command((meta->>'id')::uuid,(meta->>'version')::int))->'data';
select is(public.read_shared_game((select id from old_share))->>'runtimeVersion','fusuma-1','republish v1 snapshot ignores v2 draft');
select is(public.mutate_game('delete',pg_temp.command((select (meta->>'id')::uuid from illustrated),(select (meta->>'version')::int from illustrated)))->'data'->>'deleted','true','v2 can be deleted with flag disabled');
select ok(not has_function_privilege('anon','private.validate_question_image(jsonb)','execute'),'anon cannot run image validator');
select ok(not has_function_privilege('authenticated','private.validate_question_image(jsonb)','execute'),'browser cannot run image validator directly');
create function pg_temp.jpeg_picture(target int) returns jsonb language plpgsql as $$
declare original bytea=decode('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDwKiiivgj6M//Z','base64'); b bytea; remaining int; amount int;
begin
  remaining:=target-octet_length(original);b:=substring(original from 1 for 2);
  while remaining>0 loop
    amount:=least(65537,remaining);if remaining-amount between 1 and 3 then amount:=amount-4;end if;
    b:=b||decode('fffe'||lpad(to_hex(amount-2),4,'0')||repeat('00',amount-4),'hex');remaining:=remaining-amount;
  end loop;
  b:=b||substring(original from 3);
  return pg_temp.picture()||jsonb_build_object('dataUrl','data:image/jpeg;base64,'||replace(encode(b,'base64'),E'\n',''));
end;
$$;
create function pg_temp.image_boundary(target int) returns jsonb language plpgsql as $$
declare p jsonb=pg_temp.project(12)||'{"schemaVersion":2}'; n int; current_bytes int; last_bytes int;
begin
  for n in 0..11 loop p:=jsonb_set(p,array['questions',n::text,'image'],pg_temp.jpeg_picture(131072)); end loop;
  current_bytes:=octet_length(private.project_text(p));
  last_bytes:=((target-current_bytes+174764)/4)*3;
  p:=jsonb_set(p,'{questions,11,image}',pg_temp.jpeg_picture(last_bytes));
  p:=jsonb_set(p,'{title}',to_jsonb((p->>'title')||repeat('x',target-octet_length(private.project_text(p)))));
  return p;
end;
$$;
create function pg_temp.text_boundary(target int) returns jsonb language plpgsql as $$
declare p jsonb=pg_temp.project(200)||'{"schemaVersion":2}'; remaining int; n int; amount int; old text;
begin
  remaining:=target-octet_length(private.project_text(p));
  for n in 0..199 loop
    old:=p->'questions'->n->>'prompt';amount:=least(remaining,1000-char_length(old));
    p:=jsonb_set(p,array['questions',n::text,'prompt'],to_jsonb(old||repeat('x',amount)));remaining:=remaining-amount;
    amount:=least(remaining,800);p:=jsonb_set(p,array['questions',n::text,'romajiHint'],to_jsonb(repeat('x',amount)));remaining:=remaining-amount;
  end loop;
  if remaining<>0 then raise exception 'bad fixture'; end if;
  return jsonb_set(p,'{questions,0,image}',pg_temp.picture());
end;
$$;
select is(octet_length(private.project_text(pg_temp.image_boundary(2097152))),2097152,'2 MiB exact fixture');
select is(private.validate_project(pg_temp.image_boundary(2097152)::text,'publish')->>'ok','true','2 MiB accepted');
select is(private.validate_project(pg_temp.image_boundary(2097153)::text,'publish')->'error'->>'code','LIMIT','2 MiB plus one rejected');
select is(private.validate_project(pg_temp.text_boundary(262144)::text,'publish')->>'ok','true','text 256 KiB accepted with image');
select is(private.validate_project(pg_temp.text_boundary(262145)::text,'publish')->'error'->>'code','LIMIT','text 256 KiB plus one rejected with image');
select ok(private.validate_question_image(pg_temp.jpeg_picture(131072)),'JPEG 128 KiB accepted');
select ok(not private.validate_question_image(pg_temp.jpeg_picture(131073)),'JPEG 128 KiB plus one rejected');
select ok(not private.validate_question_image(pg_temp.picture()||jsonb_build_object('dataUrl','data:image/png;base64,'||
 replace(encode(set_byte(decode(split_part(pg_temp.picture()->>'dataUrl',',',2),'base64'),100,255),'base64'),E'\n',''))),'PNG corrupt CRC rejected');
select * from finish();
rollback;

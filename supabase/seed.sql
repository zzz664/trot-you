-- FICTIONAL LOCAL DEVELOPMENT DATA ONLY. No auth users, memberships or admins.
-- Not part of production migrations; never run a production reset/seed.
insert into public.artists (id, slug, name, intro, grade, status)
values
  ('00000000-0000-4000-8000-000000000001', 'fictional-spring', '가상 가수 봄',
   '개발 전용 가상 가수입니다. 실제 인물·계약·콘텐츠가 아닙니다.', 'B', 'active'),
  ('00000000-0000-4000-8000-000000000002', 'fictional-star', '가상 가수 별',
   '공개되지 않는 개발용 초안입니다. 실제 인물이 아닙니다.', 'C', 'draft')
on conflict (id) do nothing;

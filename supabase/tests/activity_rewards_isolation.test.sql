begin isolation level repeatable read;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
set local role authenticated;
select throws_ok($$select public.point_ui_activity()$$,'25001','BOARD_ISOLATION_UNSUPPORTED','activity snapshot rejects stale repeatable read authority');
reset role;
select * from finish();
rollback;

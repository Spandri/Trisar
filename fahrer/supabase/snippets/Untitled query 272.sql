select
  dll.driver_id,
  p.driver_number,
  p.first_name,
  p.last_name
from public.driver_live_locations dll
left join public.profiles p on p.id = dll.driver_id;

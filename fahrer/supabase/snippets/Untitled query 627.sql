select id, driver_id, status, refusal_reason, refused_by_driver_id, updated_at
from jobs
order by updated_at desc
limit 30;





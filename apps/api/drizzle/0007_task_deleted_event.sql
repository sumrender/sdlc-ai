-- TASK_DELETED lets live SSE clients drop the Task from the board and the
-- detail page the moment it is deleted. The Event row itself never persists:
-- it is cascade-deleted with the Task, so only clients connected at that
-- moment receive it; everyone else simply refetches a list without the Task.
ALTER TYPE "event_type" ADD VALUE 'TASK_DELETED';

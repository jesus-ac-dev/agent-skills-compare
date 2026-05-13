UPDATE public.files_sources fs
SET status = 'completed'
WHERE EXISTS (
    SELECT 1
    FROM public.analysis a
    WHERE a.file_source_id = fs.id
);
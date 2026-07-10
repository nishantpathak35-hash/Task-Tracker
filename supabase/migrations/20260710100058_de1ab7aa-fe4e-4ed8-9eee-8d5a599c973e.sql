
CREATE POLICY "task-files: org members read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'task-files' AND (storage.foldername(name))[1] = public.current_org_id()::text);

CREATE POLICY "task-files: org members insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'task-files' AND (storage.foldername(name))[1] = public.current_org_id()::text);

CREATE POLICY "task-files: org members delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'task-files' AND (storage.foldername(name))[1] = public.current_org_id()::text);

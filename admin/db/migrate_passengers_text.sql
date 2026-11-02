-- Migriere passengers Spalte von text[] zu text
-- Das behebt das Supabase Array-Konvertierungsproblem

ALTER TABLE public.jobs 
  ALTER COLUMN passengers TYPE text USING (
    CASE 
      WHEN passengers IS NULL THEN NULL
      WHEN array_length(passengers, 1) = 0 THEN ''
      ELSE array_to_string(passengers, ';')
    END
  );

-- Setze default zu leerer String statt leeres Array
ALTER TABLE public.jobs 
  ALTER COLUMN passengers SET DEFAULT '';

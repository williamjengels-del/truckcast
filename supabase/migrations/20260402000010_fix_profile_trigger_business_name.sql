-- Fix handle_new_user trigger to populate business_name from user metadata.
-- The original trigger inserted only the user id, leaving business_name null
-- even when it was passed via options.data during signUp(). This caused the
-- business name to be lost for users who sign up with email confirmation enabled
-- (no session exists when the client-side update runs, so RLS blocks it).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, business_name)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'business_name'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

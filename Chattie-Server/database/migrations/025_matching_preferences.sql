UPDATE user_preferences
SET interested_in = 'All'
WHERE LOWER(BTRIM(interested_in)) IN ('men', 'women', 'everyone', 'other', 'male', 'female', 'man', 'woman', 'nonbinary', 'non-binary');

UPDATE user_profiles
SET gender = 'other'
WHERE LOWER(BTRIM(gender)) = 'everyone';

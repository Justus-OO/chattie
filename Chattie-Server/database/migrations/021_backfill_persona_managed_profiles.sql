INSERT INTO user_media (user_id, url, is_primary, sort_order)
SELECT u.id, p.avatar_url, TRUE, 0
FROM users u
JOIN user_profiles p ON p.user_id = u.id
WHERE u.role = 'persona'
  AND NULLIF(BTRIM(p.avatar_url), '') IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM user_media um
      WHERE um.user_id = u.id AND NULLIF(BTRIM(um.url), '') IS NOT NULL
  );

INSERT INTO managed_profiles (id, name, avatar_url, archetype, status)
SELECT u.id,
       LEFT(COALESCE(NULLIF(p.display_name, ''), u.username), 100),
       COALESCE(p.avatar_url, ''),
       COALESCE(NULLIF(p.intent, ''), 'General'),
       'offline'
FROM users u
LEFT JOIN user_profiles p ON p.user_id = u.id
WHERE u.role = 'persona'
ON CONFLICT (id) DO NOTHING;

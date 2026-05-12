CREATE OR REPLACE VIEW analysis_with_axes AS
SELECT
  a.id,
  a.summary,
  a.maturity,
  a.score,
  c.name                                    AS class,
  ARRAY_REMOVE(ARRAY_AGG(DISTINCT d.name), NULL)   AS domains,
  ARRAY_REMOVE(ARRAY_AGG(DISTINCT act.name), NULL) AS activities,
  ARRAY_REMOVE(ARRAY_AGG(DISTINCT t.name), NULL)   AS tags,
  fs.url    AS file_url,
  fs.path   AS file_path,
  r.id      AS repo_id,
  r.name    AS repo_name,
  r.repo_url,
  r.avatar_url,
  r.stars
FROM analysis a
JOIN files_sources fs       ON fs.id = a.file_source_id
JOIN repos r                ON r.id = fs.repo_id
LEFT JOIN classes c         ON c.id = a.class_id
LEFT JOIN analysis_domains ad    ON ad.analysis_id = a.id
LEFT JOIN domains d         ON d.id = ad.domain_id
LEFT JOIN analysis_activities aa ON aa.analysis_id = a.id
LEFT JOIN activities act    ON act.id = aa.activity_id
LEFT JOIN analysis_tags at  ON at.analysis_id = a.id
LEFT JOIN tags t            ON t.id = at.tag_id
WHERE r.status = 'done'
GROUP BY a.id, c.name, fs.url, fs.path, r.id, r.name, r.repo_url, r.avatar_url, r.stars
ORDER BY a.score DESC NULLS LAST;

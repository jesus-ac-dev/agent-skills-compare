


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."activities" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL
);


ALTER TABLE "public"."activities" OWNER TO "postgres";


ALTER TABLE "public"."activities" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."activities_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."analysis" (
    "id" bigint NOT NULL,
    "file_source_id" bigint,
    "summary" "text",
    "use_cases" "jsonb" DEFAULT '[]'::"jsonb",
    "maturity" "text",
    "score" double precision,
    "model" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "class_id" bigint
);


ALTER TABLE "public"."analysis" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."analysis_activities" (
    "analysis_id" bigint NOT NULL,
    "activity_id" bigint NOT NULL
);


ALTER TABLE "public"."analysis_activities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."analysis_domains" (
    "analysis_id" bigint NOT NULL,
    "domain_id" bigint NOT NULL
);


ALTER TABLE "public"."analysis_domains" OWNER TO "postgres";


ALTER TABLE "public"."analysis" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."analysis_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."analysis_tags" (
    "analysis_id" bigint NOT NULL,
    "tag_id" bigint NOT NULL
);


ALTER TABLE "public"."analysis_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."classes" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL
);


ALTER TABLE "public"."classes" OWNER TO "postgres";


ALTER TABLE "public"."classes" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."classes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."domains" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL
);


ALTER TABLE "public"."domains" OWNER TO "postgres";


ALTER TABLE "public"."domains" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."domains_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."file_types" (
    "id" integer NOT NULL,
    "name" "text" NOT NULL
);


ALTER TABLE "public"."file_types" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."file_types_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."file_types_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."file_types_id_seq" OWNED BY "public"."file_types"."id";



CREATE TABLE IF NOT EXISTS "public"."files_sources" (
    "id" bigint NOT NULL,
    "repo_id" bigint,
    "url" "text" NOT NULL,
    "path" "text",
    "hash" "text",
    "source_type_id" integer,
    "file_type_id" integer,
    "last_checked" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."files_sources" OWNER TO "postgres";


ALTER TABLE "public"."files_sources" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."files_sources_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."repos" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "repo_url" "text" NOT NULL,
    "stars" integer DEFAULT 0,
    "last_commit" timestamp with time zone,
    "tags" "jsonb" DEFAULT '[]'::"jsonb",
    "score" double precision DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "avatar_url" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "last_processed_at" timestamp with time zone,
    "error_count" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    CONSTRAINT "repos_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'done'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."repos" OWNER TO "postgres";


ALTER TABLE "public"."repos" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."repos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."source_types" (
    "id" integer NOT NULL,
    "name" "text" NOT NULL
);


ALTER TABLE "public"."source_types" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."source_types_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."source_types_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."source_types_id_seq" OWNED BY "public"."source_types"."id";



CREATE TABLE IF NOT EXISTS "public"."tags" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL
);


ALTER TABLE "public"."tags" OWNER TO "postgres";


ALTER TABLE "public"."tags" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."tags_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."file_types" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."file_types_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."source_types" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."source_types_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_name_unique" UNIQUE ("name");



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."analysis_activities"
    ADD CONSTRAINT "analysis_activities_pkey" PRIMARY KEY ("analysis_id", "activity_id");



ALTER TABLE ONLY "public"."analysis_domains"
    ADD CONSTRAINT "analysis_domains_pkey" PRIMARY KEY ("analysis_id", "domain_id");



ALTER TABLE ONLY "public"."analysis"
    ADD CONSTRAINT "analysis_file_source_unique" UNIQUE ("file_source_id");



ALTER TABLE ONLY "public"."analysis"
    ADD CONSTRAINT "analysis_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."analysis_tags"
    ADD CONSTRAINT "analysis_tags_pkey" PRIMARY KEY ("analysis_id", "tag_id");



ALTER TABLE ONLY "public"."classes"
    ADD CONSTRAINT "classes_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."classes"
    ADD CONSTRAINT "classes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."domains"
    ADD CONSTRAINT "domains_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."domains"
    ADD CONSTRAINT "domains_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."file_types"
    ADD CONSTRAINT "file_types_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."file_types"
    ADD CONSTRAINT "file_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."files_sources"
    ADD CONSTRAINT "files_sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."files_sources"
    ADD CONSTRAINT "files_sources_url_key" UNIQUE ("url");



ALTER TABLE ONLY "public"."repos"
    ADD CONSTRAINT "repos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."repos"
    ADD CONSTRAINT "repos_repo_url_key" UNIQUE ("repo_url");



ALTER TABLE ONLY "public"."source_types"
    ADD CONSTRAINT "source_types_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."source_types"
    ADD CONSTRAINT "source_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_name_unique" UNIQUE ("name");



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_analysis_activities_activity_id" ON "public"."analysis_activities" USING "btree" ("activity_id");



CREATE INDEX "idx_analysis_domains_domain_id" ON "public"."analysis_domains" USING "btree" ("domain_id");



CREATE INDEX "idx_analysis_file_source_id" ON "public"."analysis" USING "btree" ("file_source_id");



CREATE INDEX "idx_analysis_tags_tag_id" ON "public"."analysis_tags" USING "btree" ("tag_id");



CREATE INDEX "idx_files_sources_repo_id" ON "public"."files_sources" USING "btree" ("repo_id");



CREATE INDEX "idx_repos_status" ON "public"."repos" USING "btree" ("status");



ALTER TABLE ONLY "public"."analysis_activities"
    ADD CONSTRAINT "analysis_activities_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."analysis_activities"
    ADD CONSTRAINT "analysis_activities_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "public"."analysis"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."analysis"
    ADD CONSTRAINT "analysis_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."analysis_domains"
    ADD CONSTRAINT "analysis_domains_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "public"."analysis"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."analysis_domains"
    ADD CONSTRAINT "analysis_domains_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."analysis"
    ADD CONSTRAINT "analysis_file_source_id_fkey" FOREIGN KEY ("file_source_id") REFERENCES "public"."files_sources"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."analysis_tags"
    ADD CONSTRAINT "analysis_tags_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "public"."analysis"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."analysis_tags"
    ADD CONSTRAINT "analysis_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."files_sources"
    ADD CONSTRAINT "files_sources_file_type_id_fkey" FOREIGN KEY ("file_type_id") REFERENCES "public"."file_types"("id");



ALTER TABLE ONLY "public"."files_sources"
    ADD CONSTRAINT "files_sources_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."files_sources"
    ADD CONSTRAINT "files_sources_source_type_id_fkey" FOREIGN KEY ("source_type_id") REFERENCES "public"."source_types"("id");



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON TABLE "public"."activities" TO "anon";
GRANT ALL ON TABLE "public"."activities" TO "authenticated";
GRANT ALL ON TABLE "public"."activities" TO "service_role";



GRANT ALL ON SEQUENCE "public"."activities_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."activities_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."activities_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."analysis" TO "anon";
GRANT ALL ON TABLE "public"."analysis" TO "authenticated";
GRANT ALL ON TABLE "public"."analysis" TO "service_role";



GRANT ALL ON TABLE "public"."analysis_activities" TO "anon";
GRANT ALL ON TABLE "public"."analysis_activities" TO "authenticated";
GRANT ALL ON TABLE "public"."analysis_activities" TO "service_role";



GRANT ALL ON TABLE "public"."analysis_domains" TO "anon";
GRANT ALL ON TABLE "public"."analysis_domains" TO "authenticated";
GRANT ALL ON TABLE "public"."analysis_domains" TO "service_role";



GRANT ALL ON SEQUENCE "public"."analysis_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."analysis_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."analysis_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."analysis_tags" TO "anon";
GRANT ALL ON TABLE "public"."analysis_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."analysis_tags" TO "service_role";



GRANT ALL ON TABLE "public"."classes" TO "anon";
GRANT ALL ON TABLE "public"."classes" TO "authenticated";
GRANT ALL ON TABLE "public"."classes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."classes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."classes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."classes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."domains" TO "anon";
GRANT ALL ON TABLE "public"."domains" TO "authenticated";
GRANT ALL ON TABLE "public"."domains" TO "service_role";



GRANT ALL ON SEQUENCE "public"."domains_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."domains_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."domains_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."file_types" TO "anon";
GRANT ALL ON TABLE "public"."file_types" TO "authenticated";
GRANT ALL ON TABLE "public"."file_types" TO "service_role";



GRANT ALL ON SEQUENCE "public"."file_types_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."file_types_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."file_types_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."files_sources" TO "anon";
GRANT ALL ON TABLE "public"."files_sources" TO "authenticated";
GRANT ALL ON TABLE "public"."files_sources" TO "service_role";



GRANT ALL ON SEQUENCE "public"."files_sources_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."files_sources_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."files_sources_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."repos" TO "anon";
GRANT ALL ON TABLE "public"."repos" TO "authenticated";
GRANT ALL ON TABLE "public"."repos" TO "service_role";



GRANT ALL ON SEQUENCE "public"."repos_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."repos_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."repos_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."source_types" TO "anon";
GRANT ALL ON TABLE "public"."source_types" TO "authenticated";
GRANT ALL ON TABLE "public"."source_types" TO "service_role";



GRANT ALL ON SEQUENCE "public"."source_types_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."source_types_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."source_types_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."tags" TO "anon";
GRANT ALL ON TABLE "public"."tags" TO "authenticated";
GRANT ALL ON TABLE "public"."tags" TO "service_role";



GRANT ALL ON SEQUENCE "public"."tags_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."tags_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."tags_id_seq" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";








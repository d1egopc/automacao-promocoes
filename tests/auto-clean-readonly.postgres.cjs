"use strict";
const assert=require("node:assert/strict");
const {Pool}=require("pg");
const {validateReadOnly}=require("../modules/engine/auto-clean/recurring-lane");
(async()=>{
  const url=process.env.AUTO_CLEAN_TEST_DATABASE_URL;
  if(!url || !/^postgresql:\/\/[^/]*@127\.0\.0\.1:\d+\/auto_clean_fixture$/.test(url))throw Error("isolated_loopback_fixture_required");
  const pool=new Pool({connectionString:url,max:1,connectionTimeoutMillis:1000});
  try{
    const version=await pool.query("SHOW server_version_num");assert.ok(Number(version.rows[0].server_version_num)>=170000);
    await pool.query("CREATE TABLE retention_fixture(id int); INSERT INTO retention_fixture VALUES(1)");
    await assert.rejects(()=>validateReadOnly({pool,inventory:async({queryEngine})=>{
      await queryEngine("DELETE FROM retention_fixture");return [];
    }}),error=>error.code==="25006");
    const result=await validateReadOnly({pool,inventory:async({queryEngine})=>{
      const row=await queryEngine("SELECT count(*)::int AS n FROM retention_fixture");
      assert.equal(row.resultado.rows[0].n,1);return [{protegidos:1}];
    }});
    assert.equal(result.protected,1);assert.equal(result.removed,0);
    console.log("AUTO_CLEAN_READ_ONLY_POSTGRES17_PASS");
  }finally{await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});

// 用同一映射把 320x180 的测试图渲染到不同缓冲尺寸，检查低分辨率下是否出现跳变
const fs=require("fs"),z=require("zlib");
const src=fs.existsSync("build/out/p_src.png");
console.log("src exists", src);

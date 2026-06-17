import { useScrollReveal } from "@/hooks/useScrollReveal";
import { Download as DownloadIcon, Cpu, HardDrive, Wifi, AlertTriangle } from "lucide-react";

const requirements = [
  { icon: Cpu, label: "系统", value: "Windows 11 x64" },
  { icon: HardDrive, label: "存储", value: "约 200MB 安装空间" },
  { icon: Wifi, label: "网络", value: "使用真实 MiMo API 时需要" },
];

export default function Download() {
  const { ref, isVisible } = useScrollReveal<HTMLElement>();

  return (
    <section ref={ref} id="download" className="relative py-24 sm:py-32 bg-dark-950">
      <div className="container mx-auto px-4">
        {/* Section header */}
        <div
          className={`text-center mb-16 transition-all duration-700 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            下载 Mimodex
          </h2>
          <p className="text-dark-400 text-lg max-w-xl mx-auto">
            当前版本 v0.1.5 Windows Pre-release
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {/* Download card */}
          <div
            className={`p-8 rounded-2xl bg-dark-900/50 border border-dark-800 transition-all duration-700 delay-200 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
            }`}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-brand-400/10 flex items-center justify-center">
                <DownloadIcon className="w-5 h-5 text-brand-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Windows 安装包</h3>
                <p className="text-dark-500 text-sm">Mimodex_0.1.5_x64-setup.exe</p>
              </div>
            </div>

            <div className="space-y-4 mb-8">
              <div className="flex justify-between py-2 border-b border-dark-800">
                <span className="text-dark-500 text-sm">版本</span>
                <span className="text-white text-sm font-mono">v0.1.5</span>
              </div>
              <div className="flex justify-between py-2 border-b border-dark-800">
                <span className="text-dark-500 text-sm">平台</span>
                <span className="text-white text-sm">Windows 11 x64</span>
              </div>
              <div className="flex justify-between py-2 border-b border-dark-800">
                <span className="text-dark-500 text-sm">状态</span>
                <span className="text-brand-400 text-sm">Pre-release</span>
              </div>
            </div>

            <a
              href="https://github.com/MorganArthur/mimodex/releases/tag/0.1.5"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-4 bg-brand-400 text-dark-950 font-semibold rounded-lg hover:bg-brand-300 transition-colors duration-200"
            >
              <DownloadIcon className="w-5 h-5" />
              前往 GitHub Release 下载
            </a>

            <div className="mt-4 flex items-start gap-2 text-dark-500 text-xs">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-yellow-500/70" />
              <p>
                当前安装包未代码签名，Windows 可能显示 SmartScreen 或未知发布者提示。私测阶段请只从本仓库 Release 下载。
              </p>
            </div>
          </div>

          {/* Requirements card */}
          <div
            className={`p-8 rounded-2xl bg-dark-900/50 border border-dark-800 transition-all duration-700 delay-300 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
            }`}
          >
            <h3 className="text-lg font-semibold text-white mb-6">系统要求</h3>

            <div className="space-y-4 mb-8">
              {requirements.map((req) => (
                <div
                  key={req.label}
                  className="flex items-center gap-4 p-4 rounded-xl bg-dark-950/50"
                >
                  <div className="w-10 h-10 rounded-lg bg-dark-800 flex items-center justify-center flex-shrink-0">
                    <req.icon className="w-5 h-5 text-dark-400" />
                  </div>
                  <div>
                    <p className="text-dark-500 text-xs mb-0.5">{req.label}</p>
                    <p className="text-white text-sm font-medium">{req.value}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 rounded-xl bg-brand-400/5 border border-brand-400/10">
              <p className="text-brand-400 text-sm font-medium mb-1">无需额外安装</p>
              <p className="text-dark-500 text-xs">
                本地无需安装 Rust、Cargo、MSVC 或 Node.js，直接运行安装包即可使用。
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

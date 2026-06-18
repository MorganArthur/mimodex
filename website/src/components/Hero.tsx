import { Download, ChevronDown, Github } from "lucide-react";

export default function Hero() {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-dark-950 via-dark-950 to-dark-900" />
      
      {/* Subtle grid pattern */}
      <div 
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(163, 230, 53, 0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(163, 230, 53, 0.5) 1px, transparent 1px)`,
          backgroundSize: '60px 60px'
        }}
      />

      {/* Glow effect */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-brand-500/10 rounded-full blur-[120px]" />

      <div className="relative z-10 container mx-auto px-4 text-center">
        {/* Logo */}
        <div className="opacity-0-init animate-fade-in-up mb-8">
          <div className="inline-flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-brand-400 flex items-center justify-center">
              <span className="text-dark-950 font-mono font-bold text-2xl">M</span>
            </div>
            <span className="font-mono text-3xl font-bold text-white tracking-tight">Mimodex</span>
          </div>
        </div>

        {/* Main headline */}
        <h1 className="opacity-0-init animate-fade-in-up animate-delay-100 text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-white mb-6 leading-tight">
          本地优先的
          <br />
          <span className="text-brand-400">桌面编程 Agent</span>
        </h1>

        {/* Subtitle */}
        <p className="opacity-0-init animate-fade-in-up animate-delay-200 text-lg sm:text-xl text-dark-400 max-w-2xl mx-auto mb-4">
          像 Codex 一样工作，但更懂你的项目。
        </p>
        <p className="opacity-0-init animate-fade-in-up animate-delay-300 text-base text-dark-500 max-w-xl mx-auto mb-10">
          由小米 mimo-v2.5 驱动，把对话线程、项目文件、Git 变更、工具执行集中到一个 Windows 桌面应用中
        </p>

        {/* CTA Buttons */}
        <div className="opacity-0-init animate-fade-in-up animate-delay-400 flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
          <a
            href="https://github.com/MorganArthur/mimodex/releases/tag/v0.1.7"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-8 py-4 bg-brand-400 text-dark-950 font-semibold rounded-lg hover:bg-brand-300 transition-colors duration-200 text-base"
          >
            <Download className="w-5 h-5" />
            下载 v0.1.7
          </a>
          <a
            href="https://github.com/MorganArthur/mimodex"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-8 py-4 border border-brand-400/50 text-brand-400 font-semibold rounded-lg hover:bg-brand-400/10 transition-colors duration-200 text-base"
          >
            <Github className="w-5 h-5" />
            GitHub
          </a>
        </div>

        {/* Badges */}
        <div className="opacity-0-init animate-fade-in-up animate-delay-500 flex flex-wrap items-center justify-center gap-3">
          <span className="px-3 py-1.5 rounded-full bg-dark-800 text-dark-400 text-sm border border-dark-700">
            Windows 11
          </span>
          <span className="px-3 py-1.5 rounded-full bg-dark-800 text-dark-400 text-sm border border-dark-700">
            MiMo v2.5
          </span>
          <span className="px-3 py-1.5 rounded-full bg-dark-800 text-dark-400 text-sm border border-dark-700">
            本地优先
          </span>
          <span className="px-3 py-1.5 rounded-full bg-dark-800 text-dark-400 text-sm border border-dark-700">
            Pre-release
          </span>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 opacity-0-init animate-fade-in animate-delay-600">
        <a href="#features" className="flex flex-col items-center gap-2 text-dark-500 hover:text-brand-400 transition-colors">
          <span className="text-sm">向下滚动</span>
          <ChevronDown className="w-5 h-5 animate-bounce-slow" />
        </a>
      </div>
    </section>
  );
}

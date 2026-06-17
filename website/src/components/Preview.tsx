import { useScrollReveal } from "@/hooks/useScrollReveal";

export default function Preview() {
  const { ref, isVisible } = useScrollReveal<HTMLElement>();

  return (
    <section ref={ref} className="relative py-24 sm:py-32 bg-dark-950">
      <div className="container mx-auto px-4">
        {/* Section header */}
        <div
          className={`text-center mb-16 transition-all duration-700 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            真实界面展示
          </h2>
          <p className="text-dark-400 text-lg max-w-xl mx-auto">
            围绕真实本地项目工作的桌面编程 Agent
          </p>
        </div>

        {/* Main preview image */}
        <div
          className={`mb-12 transition-all duration-700 delay-200 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          <div className="rounded-2xl overflow-hidden border border-dark-800 shadow-2xl shadow-brand-400/5">
            <img
              src="/images/真实界面包装图.png"
              alt="Mimodex 真实界面"
              className="w-full h-auto"
              loading="lazy"
            />
          </div>
        </div>

        {/* Secondary images grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div
            className={`transition-all duration-700 delay-300 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
            }`}
          >
            <div className="rounded-2xl overflow-hidden border border-dark-800">
              <img
                src="/images/核心功能四宫格图.png"
                alt="Mimodex 核心功能"
                className="w-full h-auto"
                loading="lazy"
              />
            </div>
          </div>
          <div
            className={`transition-all duration-700 delay-400 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
            }`}
          >
            <div className="rounded-2xl overflow-hidden border border-dark-800">
              <img
                src="/images/主宣传图.png"
                alt="Mimodex 主宣传图"
                className="w-full h-auto"
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

<script>
  import Navbar from "./navbar.svelte";
</script>

<Navbar />
<main>
  <div class="hero min-h-screen bg-base-200">
    <div class="hero-content text-center">
      <div class="max-w-md">
        <img
          src="/hero.svg"
          alt="sweet stack banner with svelte, deno and graphql"
        />
        <h1 class="mt-8 text-5xl font-bold">The SWEET Stack!</h1>
        <p class="py-6">
          Svelte is Sexy + Deno is Dynamite + GraphQL is Grand = SWEETNESS!
        </p>
        <a
          class="btn btn-primary"
          href="https://github.com/hyper63/sweet-stack/generate"
          >Launch with Template</a
        >
        <a class="btn" href="#learn-more">Learn more</a>
      </div>
    </div>
  </div>
</main>
<footer class="footer footer-center p-4 bg-base-300 text-base-content">
  <div>
    <p>Copyright © 2022 - All right reserved by hyper63, LLC</p>
  </div>
</footer>
